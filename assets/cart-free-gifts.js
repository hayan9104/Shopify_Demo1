import { Component } from '@theme/component';
import { fetchConfig } from '@theme/utilities';
import { ThemeEvents, CartUpdateEvent, CartAddEvent, DiscountUpdateEvent, QuantitySelectorUpdateEvent } from '@theme/events';

/**
 * @typedef {Object} GiftConfig
 * @property {string} variantId - Variant ID of the gift
 * @property {number} threshold - Cart total threshold in cents
 * @property {string} tag - Product tag for the gift
 */

/**
 * Free Gift Configuration
 * Variant IDs for free gifts at different thresholds
 * @type {{gift5000: GiftConfig, gift8000: GiftConfig}}
 */
const FREE_GIFT_CONFIG = {
  gift5000: {
    variantId: '55378709479497', // ₹5,000 threshold gift
    threshold: 500000, // ₹5,000 in cents (₹5,000 * 100)
    tag: 'free-gift-5000',
  },
  gift8000: {
    variantId: '55378884591689', // ₹8,000 threshold gift
    threshold: 800000, // ₹8,000 in cents (₹8,000 * 100)
    tag: 'free-gift-8000',
  },
};

/**
 * @typedef {Object} CartItem
 * @property {number} variant_id - Variant ID
 * @property {number} [line] - Line number (1-based)
 * @property {number} [final_line_price] - Final line price in cents
 * @property {number} [line_price] - Line price in cents
 */

/**
 * @typedef {Object} Cart
 * @property {number} total_price - Cart total in cents
 * @property {number} [item_count] - Number of items in cart
 * @property {CartItem[]} items - Cart items array
 */

/**
 * A custom element that manages automatic free gift addition based on cart total.
 * 
 * Listens to cart update events and automatically adds/removes free gifts
 * when cart total crosses defined thresholds.
 */
class CartFreeGifts extends Component {
  #isProcessing = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  #processingTimeout = null;

  connectedCallback() {
    super.connectedCallback();
    
    // Listen to cart update events
    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    
    // Listen to quantity selector updates to prevent free gift quantity changes
    document.addEventListener(ThemeEvents.quantitySelectorUpdate, this.#handleQuantityUpdate);
    
    // Also check on initial load if cart has items
    this.#checkAndUpdateGifts();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    
    document.removeEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.removeEventListener(ThemeEvents.quantitySelectorUpdate, this.#handleQuantityUpdate);
    
    if (this.#processingTimeout) {
      clearTimeout(this.#processingTimeout);
    }
  }

  /**
   * Handles quantity selector updates to prevent free gift quantity changes
   * @param {QuantitySelectorUpdateEvent} event - The quantity selector update event
   */
  #handleQuantityUpdate = async (event) => {
    // Check if this is a free gift item trying to change quantity
    const cart = await this.#fetchCart();
    if (!cart || !cart.items) return;

    const { cartLine: line, quantity } = /** @type {QuantitySelectorUpdateEvent} */ (event).detail || {};
    if (!line || !quantity) return;

    const cartItem = cart.items[line - 1];
    if (!cartItem) return;

    // Check if this item is a free gift
    const isFreeGift = this.#isFreeGiftItem(cartItem);
    
    if (isFreeGift && quantity !== 1) {
      // Prevent quantity change - reset to 1
      event.preventDefault();
      event.stopPropagation();
      
      // Reset quantity to 1
      const cartItemsComponents = document.querySelectorAll('cart-items-component');
      const sectionsToUpdate = new Set();
      
      cartItemsComponents.forEach((item) => {
        if (item instanceof HTMLElement && item.dataset.sectionId) {
          sectionsToUpdate.add(item.dataset.sectionId);
        }
      });

      const body = JSON.stringify({
        line: line,
        quantity: 1,
        sections: Array.from(sectionsToUpdate).join(','),
        sections_url: window.location.pathname,
      });

      await fetch(Theme.routes.cart_change_url, {
        ...fetchConfig('json', { body }),
      });
    }
  };

  /**
   * Checks if a cart item is a free gift
   * @param {CartItem} item - Cart item to check
   * @returns {boolean} True if item is a free gift
   */
  #isFreeGiftItem(item) {
    // Check if item has _auto_gift property
    // Note: Properties are not directly available in cart.js response
    // We'll check by variant ID instead
    const freeGiftVariantIds = [
      FREE_GIFT_CONFIG.gift5000.variantId,
      FREE_GIFT_CONFIG.gift8000.variantId,
    ];
    
    return freeGiftVariantIds.includes(item.variant_id.toString());
  }

  /**
   * Handles cart update events
   * @param {CartUpdateEvent | CartAddEvent} event - The cart update event
   */
  #handleCartUpdate = async (event) => {
    // Skip if this event came from this component to avoid infinite loops
    if (event.detail?.sourceId === 'cart-free-gifts' || event.detail?.data?.source === 'cart-free-gifts') {
      return;
    }

    // Debounce to avoid multiple rapid updates
    if (this.#processingTimeout) {
      clearTimeout(this.#processingTimeout);
    }

    this.#processingTimeout = setTimeout(() => {
      this.#checkAndUpdateGifts();
    }, 500); // Wait 500ms after cart update
  };

  /**
   * Checks cart total and adds/removes free gifts accordingly
   */
  async #checkAndUpdateGifts() {
    // Prevent concurrent processing
    if (this.#isProcessing) {
      return;
    }

    this.#isProcessing = true;

    try {
      // Fetch current cart state
      const cart = await this.#fetchCart();
      
      if (!cart) {
        this.#isProcessing = false;
        return;
      }

      // If cart is empty, remove all free gifts and return
      const cartItemCount = /** @type {Cart} */ (cart).item_count || (cart.items ? cart.items.length : 0);
      if (!cart.items || cart.items.length === 0 || cartItemCount === 0) {
        // Remove any remaining free gifts
        await this.#removeAllFreeGifts(cart);
        this.#isProcessing = false;
        return;
      }

      // Calculate cart total excluding free gift items
      const cartTotal = this.#calculateCartTotalExcludingFreeGifts(cart);

      // Only proceed if there are paid items in the cart
      if (cartTotal <= 0) {
        // No paid items, remove all free gifts
        await this.#removeAllFreeGifts(cart);
        this.#isProcessing = false;
        return;
      }

      // Check and handle ₹8,000 gift (higher threshold first)
      await this.#handleGift(cart, FREE_GIFT_CONFIG.gift8000, cartTotal);
      
      // Check and handle ₹5,000 gift
      await this.#handleGift(cart, FREE_GIFT_CONFIG.gift5000, cartTotal);

    } catch (error) {
      console.error('Error managing free gifts:', error);
    } finally {
      this.#isProcessing = false;
    }
  }

  /**
   * Calculates cart total excluding free gift items
   * @param {Cart} cart - Cart object
   * @returns {number} Cart total in cents excluding free gifts
   */
  #calculateCartTotalExcludingFreeGifts(cart) {
    if (!cart.items || !Array.isArray(cart.items)) {
      return 0;
    }

    let total = 0;
    for (const item of cart.items) {
      const isFreeGift = this.#isFreeGiftItem(item);
      if (!isFreeGift) {
        // Add only non-free-gift items to total
        total += item.final_line_price || item.line_price || 0;
      }
    }

    return total;
  }

  /**
   * Removes all free gifts from the cart
   * @param {Cart} cart - Current cart object
   */
  async #removeAllFreeGifts(cart) {
    if (!cart.items || !Array.isArray(cart.items)) {
      return;
    }

    // Find all free gift items and remove them
    for (const item of cart.items) {
      if (this.#isFreeGiftItem(item)) {
        await this.#removeGiftFromCart(cart, item.variant_id.toString());
      }
    }
  }

  /**
   * Handles adding or removing a specific gift based on cart total
   * @param {Cart} cart - Current cart object
   * @param {GiftConfig} giftConfig - Gift configuration
   * @param {number} cartTotal - Current cart total in cents (excluding free gifts)
   */
  async #handleGift(cart, giftConfig, cartTotal) {
    const isGiftInCart = this.#isGiftInCart(cart, giftConfig.variantId);
    const shouldHaveGift = cartTotal >= giftConfig.threshold;

    if (shouldHaveGift && !isGiftInCart) {
      // Add gift only if cart total meets threshold
      await this.#addGiftToCart(giftConfig.variantId);
    } else if (!shouldHaveGift && isGiftInCart) {
      // Remove gift if cart total is below threshold
      await this.#removeGiftFromCart(cart, giftConfig.variantId);
    }
  }

  /**
   * Checks if a gift variant is already in the cart
   * @param {Cart} cart - Cart object
   * @param {string} variantId - Variant ID to check
   * @returns {boolean} True if gift is in cart
   */
  #isGiftInCart(cart, variantId) {
    if (!cart.items || !Array.isArray(cart.items)) {
      return false;
    }

    return cart.items.some(
      (item) => /** @type {CartItem} */ (item).variant_id.toString() === variantId.toString()
    );
  }

  /**
   * Adds a free gift to the cart
   * @param {string} variantId - Variant ID of the gift to add
   */
  async #addGiftToCart(variantId) {
    try {
      const formData = new FormData();
      formData.append('id', variantId);
      formData.append('quantity', '1');
      
      // Mark as auto-added gift using properties
      formData.append('properties[_auto_gift]', 'true');

      // Get cart sections to update
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
        console.error('Failed to add free gift:', data.message);
        return;
      }

      // Apply 100% discount to make the item free
      // Note: This requires discount codes to be set up in Shopify Admin
      // For now, we'll apply a discount code if available
      await this.#applyFreeGiftDiscount(variantId);

      // Dispatch cart update event to refresh UI
      document.dispatchEvent(
        new CartAddEvent(data, 'cart-free-gifts', {
          source: 'cart-free-gifts',
          sections: data.sections,
        })
      );

    } catch (error) {
      console.error('Error adding free gift:', error);
    }
  }

  /**
   * Applies a discount to make the free gift item actually free
   * @param {string} variantId - Variant ID of the gift
   */
  async #applyFreeGiftDiscount(variantId) {
    try {
      // Get the cart to find the line item
      const cart = await this.#fetchCart();
      if (!cart || !cart.items) return;

      const giftItem = cart.items.find(
        (item) => item.variant_id.toString() === variantId.toString()
      );

      if (!giftItem) return;

      // Try to apply a discount code if configured
      // You need to create discount codes in Shopify Admin for free gifts
      // For example: "FREEGIFT5000" and "FREEGIFT8000"
      const discountCode = this.#getDiscountCodeForVariant(variantId);
      
      if (discountCode) {
        // Get cart sections to update
        const cartItemsComponents = document.querySelectorAll('cart-items-component');
        const sectionsToUpdate = new Set();
        
        cartItemsComponents.forEach((item) => {
          if (item instanceof HTMLElement && item.dataset.sectionId) {
            sectionsToUpdate.add(item.dataset.sectionId);
          }
        });

        // Apply discount code via cart update
        const body = JSON.stringify({
          discount: discountCode,
          sections: Array.from(sectionsToUpdate).join(','),
        });

        const response = await fetch(Theme.routes.cart_update_url, {
          ...fetchConfig('json', { body }),
        });

        const responseText = await response.text();
        const discountData = JSON.parse(responseText);

        // Dispatch discount update event to refresh UI
        if (discountData && !discountData.errors) {
          document.dispatchEvent(
            new DiscountUpdateEvent(discountData, 'cart-free-gifts')
          );
        }
      }
    } catch (error) {
      // Silently fail - discount codes may not be set up
      console.log('Discount code not applied (may not be configured):', error);
    }
  }

  /**
   * Gets the discount code for a specific variant
   * @param {string} variantId - Variant ID
   * @returns {string|null} Discount code or null
   */
  #getDiscountCodeForVariant(variantId) {
    // Map variant IDs to discount codes
    // You need to create these discount codes in Shopify Admin
    const discountCodeMap = {
      '55378709479497': 'FREEGIFT5000', // ₹5,000 threshold
      '55378884591689': 'FREEGIFT8000', // ₹8,000 threshold
    };

    return /** @type {Record<string, string>} */ (discountCodeMap)[variantId] || null;
  }

  /**
   * Removes a free gift from the cart
   * @param {Cart} cart - Current cart object
   * @param {string} variantId - Variant ID of the gift to remove
   */
  async #removeGiftFromCart(cart, variantId) {
    try {
      // Find the line item for this variant
      const giftItemIndex = cart.items.findIndex(
        (item) => /** @type {CartItem} */ (item).variant_id.toString() === variantId.toString()
      );

      if (giftItemIndex === -1) {
        return;
      }

      const giftItem = /** @type {CartItem} */ (cart.items[giftItemIndex]);

      // Get cart sections to update
      const cartItemsComponents = document.querySelectorAll('cart-items-component');
      const sectionsToUpdate = new Set();
      
      cartItemsComponents.forEach((item) => {
        if (item instanceof HTMLElement && item.dataset.sectionId) {
          sectionsToUpdate.add(item.dataset.sectionId);
        }
      });

      // Line numbers are 1-based. Use 'line' property if available, otherwise use array index + 1
      const lineNumber = giftItem.line || (giftItemIndex + 1);

      const body = JSON.stringify({
        line: lineNumber,
        quantity: 0,
        sections: Array.from(sectionsToUpdate).join(','),
        sections_url: window.location.pathname,
      });

      const response = await fetch(Theme.routes.cart_change_url, {
        ...fetchConfig('json', { body }),
      });

      const responseText = await response.text();
      const data = JSON.parse(responseText);

      if (data.errors) {
        console.error('Failed to remove free gift:', data.errors);
        return;
      }

      // Dispatch cart update event to refresh UI
      document.dispatchEvent(
        new CartUpdateEvent(data, 'cart-free-gifts', {
          source: 'cart-free-gifts',
          itemCount: data.item_count || 0,
          sections: data.sections,
        })
      );

    } catch (error) {
      console.error('Error removing free gift:', error);
    }
  }

  /**
   * Fetches the current cart state
   * @returns {Promise<Cart|null>} Cart object or null if error
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

if (!customElements.get('cart-free-gifts')) {
  customElements.define('cart-free-gifts', CartFreeGifts);
}
