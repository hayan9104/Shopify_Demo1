import { Component } from '@theme/component';
import { fetchConfig } from '@theme/utilities';
import { ThemeEvents, CartUpdateEvent, CartAddEvent, DiscountUpdateEvent } from '@theme/events';
import { sectionRenderer } from '@theme/section-renderer';

/**
 * Cart Suggested Products Component
 * Handles add to cart functionality for suggested products
 * The Liquid template handles the product selection logic server-side
 */
class CartSuggestedProducts extends Component {
  #isProcessing = false;

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.addEventListener(ThemeEvents.cartAdd, this.#handleCartUpdate);
    
    this.#initializeButtons();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.removeEventListener(ThemeEvents.cartAdd, this.#handleCartUpdate);
  }

  /**
   * Handles cart update events - re-renders the section to update suggested products
   * @param {CartUpdateEvent | CartAddEvent} event
   */
  #handleCartUpdate = async (event) => {
    if (event.detail?.source === 'cart-suggested-products') {
      return;
    }

    const cartItemsComponent = this.closest('cart-items-component');
    if (cartItemsComponent && cartItemsComponent.dataset.sectionId) {
      await sectionRenderer.renderSection(cartItemsComponent.dataset.sectionId, { cache: false });
    }
  };

  /**
   * Initializes add to cart buttons
   */
  #initializeButtons() {
    const buttons = this.querySelectorAll('[data-add-to-cart]');
    for (const button of buttons) {
      button.removeEventListener('click', this.#handleAddToCart);
      button.addEventListener('click', this.#handleAddToCart);
    }
  }

  /**
   * Handles add to cart button clicks
   * @param {Event} event - Click event
   */
  #handleAddToCart = async (event) => {
    if (this.#isProcessing) return;

    const button = /** @type {HTMLButtonElement} */ (event.currentTarget);
    if (!button || button.disabled) return;

    const variantId = button.getAttribute('data-variant-id');
    const productId = button.getAttribute('data-product-id');

    if (!variantId) return;

    this.#isProcessing = true;
    button.disabled = true;
    button.textContent = 'Adding...';

    try {
      const formData = new FormData();
      formData.append('id', variantId);
      formData.append('quantity', '1');
      formData.append('properties[_from_suggested]', 'true');

      const cartItemsComponents = document.querySelectorAll('cart-items-component');
      const sectionsToUpdate = new Set();
      
      cartItemsComponents.forEach((item) => {
        if (item instanceof HTMLElement && item.dataset.sectionId) {
          sectionsToUpdate.add(item.dataset.sectionId);
        }
      });

      const headerActionsSection = document.querySelector('header-actions');
      if (headerActionsSection && headerActionsSection.id) {
        const sectionId = headerActionsSection.id.replace('shopify-section-', '');
        if (sectionId) {
          sectionsToUpdate.add(sectionId);
        }
      }

      if (sectionsToUpdate.size > 0) {
        formData.append('sections', Array.from(sectionsToUpdate).join(','));
      }

      const response = await fetch(Theme.routes.cart_add_url, {
        ...fetchConfig('javascript', { body: formData }),
        headers: {
          ...fetchConfig('javascript', { body: formData }).headers,
          Accept: 'text/html',
        },
      });

      const data = await response.json();

      if (data.status) {
        console.error('Failed to add product:', data.message);
        button.disabled = false;
        button.textContent = '+ ADD';
        return;
      }

      document.dispatchEvent(
        new CartAddEvent(data, 'cart-suggested-products', {
          source: 'cart-suggested-products',
          sections: data.sections,
        })
      );

      await new Promise(resolve => setTimeout(resolve, 300));

      await this.#applySuggestedProductDiscount();

      if (data.sections) {
        const cartItemsComponent = this.closest('cart-items-component');
        if (cartItemsComponent && cartItemsComponent.dataset.sectionId) {
          const sectionId = cartItemsComponent.dataset.sectionId;
          if (data.sections[sectionId]) {
            await sectionRenderer.renderSection(sectionId, { cache: false });
          }
        }
      }
    } catch (error) {
      console.error('Error adding product to cart:', error);
      button.disabled = false;
      button.textContent = '+ ADD';
    } finally {
      this.#isProcessing = false;
    }
  };

  /**
   * Applies 5% discount code for suggested products
   */
  async #applySuggestedProductDiscount() {
    try {
      const discountCode = 'SUGGESTED5';
      
      const cart = await this.#fetchCart();
      if (!cart) return;

      const existingDiscounts = this.#getExistingDiscounts(cart);
      if (existingDiscounts.includes(discountCode)) {
        return;
      }

      const cartItemsComponents = document.querySelectorAll('cart-items-component');
      const sectionsToUpdate = new Set();
      
      cartItemsComponents.forEach((item) => {
        if (item instanceof HTMLElement && item.dataset.sectionId) {
          sectionsToUpdate.add(item.dataset.sectionId);
        }
      });

      if (sectionsToUpdate.size === 0) return;

      const body = JSON.stringify({
        discount: [...existingDiscounts, discountCode].join(','),
        sections: Array.from(sectionsToUpdate).join(','),
      });

      const response = await fetch(Theme.routes.cart_update_url, {
        ...fetchConfig('json', { body }),
      });

      const responseText = await response.text();
      let discountData;
      
      try {
        discountData = JSON.parse(responseText);
      } catch (parseError) {
        console.error('Error parsing discount response:', parseError);
        return;
      }

      if (discountData.errors) {
        console.error('Discount application errors:', discountData.errors);
        return;
      }

      if (discountData && discountData.discount_codes) {
        const discountApplied = discountData.discount_codes.find(
          (/** @type {{ code: string; applicable: boolean; }} */ discount) => {
            return discount.code === discountCode && discount.applicable === true;
          }
        );

        if (discountApplied) {
          document.dispatchEvent(
            new DiscountUpdateEvent(discountData, 'cart-suggested-products')
          );
          
          const cartItemsComponent = this.closest('cart-items-component');
          if (cartItemsComponent && cartItemsComponent.dataset.sectionId) {
            const sectionId = cartItemsComponent.dataset.sectionId;
            if (sectionsToUpdate.has(sectionId)) {
              await sectionRenderer.renderSection(sectionId, { cache: false });
            }
          }
        } else {
          console.warn(`Discount code "${discountCode}" was not applied. Please ensure it exists in Shopify Admin.`);
        }
      }
    } catch (error) {
      console.error('Error applying discount code:', error);
    }
  }

  /**
   * Gets existing discount codes from cart
   * @param {Object} cart - Cart object
   * @returns {string[]} Array of discount codes
   */
  #getExistingDiscounts(cart) {
    const discounts = [];
    
    if (cart.cart_level_discount_applications) {
      for (const discount of cart.cart_level_discount_applications) {
        if (discount.type === 'discount_code' && discount.title) {
          discounts.push(discount.title);
        }
      }
    }

    if (cart.items) {
      for (const item of cart.items) {
        if (item.line_level_discount_allocations) {
          for (const allocation of item.line_level_discount_allocations) {
            if (allocation.discount_application?.type === 'discount_code' && allocation.discount_application?.title) {
              discounts.push(allocation.discount_application.title);
            }
          }
        }
      }
    }

    return [...new Set(discounts)];
  }

  /**
   * Fetches the current cart
   * @returns {Promise<Object>} Cart object
   */
  async #fetchCart() {
    try {
      const response = await fetch('/cart.js');
      if (!response.ok) {
        throw new Error(`Cart fetch failed: ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching cart:', error);
      return null;
    }
  }

}

if (!customElements.get('cart-suggested-products')) {
  customElements.define('cart-suggested-products', CartSuggestedProducts);
}

