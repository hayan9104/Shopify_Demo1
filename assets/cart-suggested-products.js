import { Component } from '@theme/component';
import { fetchConfig } from '@theme/utilities';
import { ThemeEvents, CartUpdateEvent, CartAddEvent } from '@theme/events';
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

      const cartItemsComponents = document.querySelectorAll('cart-items-component');
      const sectionsToUpdate = new Set();
      
      cartItemsComponents.forEach((item) => {
        if (item instanceof HTMLElement && item.dataset.sectionId) {
          sectionsToUpdate.add(item.dataset.sectionId);
        }
      });

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
    } catch (error) {
      console.error('Error adding product to cart:', error);
      button.disabled = false;
      button.textContent = '+ ADD';
    } finally {
      this.#isProcessing = false;
    }
  };

}

if (!customElements.get('cart-suggested-products')) {
  customElements.define('cart-suggested-products', CartSuggestedProducts);
}

