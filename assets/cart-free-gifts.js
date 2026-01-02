import { Component } from '@theme/component';
import { fetchConfig } from '@theme/utilities';
import { ThemeEvents, CartUpdateEvent, CartAddEvent } from '@theme/events';

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
 */

/**
 * @typedef {Object} Cart
 * @property {number} total_price - Cart total in cents
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
    
    // Also check on initial load if cart has items
    this.#checkAndUpdateGifts();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    
    document.removeEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    
    if (this.#processingTimeout) {
      clearTimeout(this.#processingTimeout);
    }
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

      const cartTotal = /** @type {Cart} */ (cart).total_price || 0;

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
   * Handles adding or removing a specific gift based on cart total
   * @param {Cart} cart - Current cart object
   * @param {GiftConfig} giftConfig - Gift configuration
   * @param {number} cartTotal - Current cart total in cents
   */
  async #handleGift(cart, giftConfig, cartTotal) {
    const isGiftInCart = this.#isGiftInCart(cart, giftConfig.variantId);
    const shouldHaveGift = cartTotal >= giftConfig.threshold;

    if (shouldHaveGift && !isGiftInCart) {
      // Add gift
      await this.#addGiftToCart(giftConfig.variantId);
    } else if (!shouldHaveGift && isGiftInCart) {
      // Remove gift (only if it was auto-added)
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
