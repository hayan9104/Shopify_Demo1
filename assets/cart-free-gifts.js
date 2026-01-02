import { Component } from '@theme/component';
import { ThemeEvents, CartUpdateEvent, CartAddEvent } from '@theme/events';
import { fetchConfig, debounce } from '@theme/utilities';

/**
 * A custom element that automatically adds free gift products based on cart total thresholds.
 * 
 * Thresholds:
 * - ₹5,000: Adds product with tag "free-gift-5000"
 * - ₹8,000: Adds product with tag "free-gift-8000"
 * 
 * @extends {Component}
 */
class CartFreeGiftsComponent extends Component {
  /** @type {AbortController | null} */
  #activeFetch = null;

  /** @type {boolean} */
  #isProcessing = false;

  /** Debounced handler to prevent rapid-fire updates */
  #debouncedHandleCartUpdate = debounce(this.#handleCartUpdate.bind(this), 500);

  /** Thresholds in cents (paisa) */
  #THRESHOLD_5000 = 500000; // ₹5,000 = 500,000 paisa
  #THRESHOLD_8000 = 800000; // ₹8,000 = 800,000 paisa

  connectedCallback() {
    super.connectedCallback();
    
    // Listen to cart update events with debouncing
    document.addEventListener(ThemeEvents.cartUpdate, this.#debouncedHandleCartUpdate);
    
    // Check cart on initial load (in case cart already has items)
    this.#checkCartOnLoad();
  }

  /**
   * Checks cart on initial page load
   */
  async #checkCartOnLoad() {
    // Wait a bit for page to fully load
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Fetch current cart and check
    const cartData = await this.#fetchCartData();
    if (cartData) {
      // Create a synthetic event to trigger the handler
      const syntheticEvent = {
        detail: {
          resource: cartData,
          data: cartData,
          sourceId: 'initial-load',
        }
      };
      this.#handleCartUpdate(syntheticEvent);
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener(ThemeEvents.cartUpdate, this.#debouncedHandleCartUpdate);
    this.#debouncedHandleCartUpdate.cancel();
    
    if (this.#activeFetch) {
      this.#activeFetch.abort();
    }
  }

  /**
   * Handles cart update events
   * @param {CartUpdateEvent | CartAddEvent} event
   */
  #handleCartUpdate = async (event) => {
    // Prevent infinite loops
    if (this.#isProcessing) return;
    
    // Ignore events from our own component to prevent infinite loops
    if (event.detail?.sourceId === this.id || event.detail?.data?.source === 'cart-free-gifts') {
      return;
    }

    // Get cart data from event
    let cartData = event.detail?.resource || event.detail?.data;
    
    // If cart data is incomplete, fetch it
    if (!cartData || !cartData.items || cartData.total_price === undefined) {
      cartData = await this.#fetchCartData();
      if (!cartData) return;
    }

    // Get gift product variant IDs from data attributes
    const gift5000VariantId = this.dataset.gift5000VariantId;
    const gift8000VariantId = this.dataset.gift8000VariantId;

    if (!gift5000VariantId && !gift8000VariantId) {
      console.warn('CartFreeGifts: No gift variant IDs configured. Check cart-free-gifts-config.liquid');
      return;
    }

    // Debug logging
    console.log('CartFreeGifts: Checking cart', {
      cartTotal: cartData.total_price,
      gift5000VariantId,
      gift8000VariantId,
      itemCount: cartItems.length
    });

    const cartTotal = cartData.total_price || 0;
    const cartItems = cartData.items || [];

    // Check which gifts should be in cart
    const shouldHaveGift5000 = cartTotal >= this.#THRESHOLD_5000 && gift5000VariantId;
    const shouldHaveGift8000 = cartTotal >= this.#THRESHOLD_8000 && gift8000VariantId;

    // Check which gifts are currently in cart
    const hasGift5000 = this.#hasGiftInCart(cartItems, gift5000VariantId);
    const hasGift8000 = this.#hasGiftInCart(cartItems, gift8000VariantId);

    // Determine actions needed
    const actions = [];

    if (shouldHaveGift5000 && !hasGift5000) {
      actions.push({ type: 'add', variantId: gift5000VariantId, threshold: 5000 });
    } else if (!shouldHaveGift5000 && hasGift5000) {
      actions.push({ type: 'remove', variantId: gift5000VariantId, threshold: 5000 });
    }

    if (shouldHaveGift8000 && !hasGift8000) {
      actions.push({ type: 'add', variantId: gift8000VariantId, threshold: 8000 });
    } else if (!shouldHaveGift8000 && hasGift8000) {
      actions.push({ type: 'remove', variantId: gift8000VariantId, threshold: 8000 });
    }

    // Execute actions
    if (actions.length > 0) {
      this.#isProcessing = true;
      
      try {
        for (const action of actions) {
          if (action.type === 'add') {
            await this.#addGiftToCart(action.variantId, action.threshold);
          } else if (action.type === 'remove') {
            await this.#removeGiftFromCart(cartItems, action.variantId, action.threshold);
          }
        }
      } catch (error) {
        console.error('CartFreeGifts: Error processing gift actions', error);
      } finally {
        this.#isProcessing = false;
      }
    }
  };

  /**
   * Checks if a gift product is already in the cart
   * @param {Array} cartItems - Array of cart items
   * @param {string} variantId - Variant ID to check
   * @returns {boolean}
   */
  #hasGiftInCart(cartItems, variantId) {
    if (!variantId || !cartItems) return false;
    return cartItems.some(
      (item) => item.variant_id && item.variant_id.toString() === variantId.toString()
    );
  }

  /**
   * Adds a gift product to the cart
   * @param {string} variantId - Variant ID of the gift product
   * @param {number} threshold - Threshold amount (for logging)
   */
  async #addGiftToCart(variantId, threshold) {
    if (!variantId) return;

    this.#createAbortController();

    try {
      const formData = new FormData();
      formData.append('id', variantId);
      formData.append('quantity', '1');
      // Mark as auto-added gift to prevent manual removal issues
      formData.append('properties[_auto_gift]', `true`);
      formData.append('properties[_gift_threshold]', threshold.toString());

      const config = fetchConfig('javascript', { body: formData });

      const response = await fetch(Theme.routes.cart_add_url, {
        ...config,
        headers: {
          ...config.headers,
          Accept: 'text/html',
        },
        signal: this.#activeFetch?.signal,
      });

      const data = await response.json();

      if (data.status) {
        console.error(`CartFreeGifts: Failed to add gift for ₹${threshold} threshold:`, {
          message: data.message,
          description: data.description,
          errors: data.errors,
          variantId: variantId,
          note: 'If product is POS-only, it may not be addable via storefront API. Check product settings in Shopify Admin.'
        });
        return;
      }

      // Dispatch cart update event to refresh cart UI
      document.dispatchEvent(
        new CartAddEvent(data, this.id, {
          source: 'cart-free-gifts',
          variantId: variantId,
        })
      );

      console.log(`CartFreeGifts: Successfully added free gift for ₹${threshold} threshold`, {
        variantId: variantId,
        cartTotal: data.total_price
      });
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error(`CartFreeGifts: Error adding gift for ₹${threshold} threshold:`, error);
    }
  }

  /**
   * Removes a gift product from the cart
   * @param {Array} cartItems - Array of cart items
   * @param {string} variantId - Variant ID of the gift product
   * @param {number} threshold - Threshold amount (for logging)
   */
  async #removeGiftFromCart(cartItems, variantId, threshold) {
    if (!variantId || !cartItems) return;

    // Find the line item for this variant
    const giftItem = cartItems.find(
      (item) => item.variant_id && item.variant_id.toString() === variantId.toString()
    );

    if (!giftItem || !giftItem.key) {
      console.warn(`CartFreeGifts: Gift item not found for removal (₹${threshold} threshold)`);
      return;
    }

    this.#createAbortController();

    try {
      // Get cart section IDs to refresh
      const cartSectionIds = this.#getCartSectionIds();

      const body = JSON.stringify({
        updates: {
          [giftItem.key]: 0,
        },
        sections: cartSectionIds.join(','),
      });

      const response = await fetch(Theme.routes.cart_update_url, {
        ...fetchConfig('json', { body }),
        signal: this.#activeFetch?.signal,
      });

      const responseText = await response.text();
      const data = JSON.parse(responseText);

      if (data.errors) {
        console.warn(`CartFreeGifts: Failed to remove gift for ₹${threshold} threshold:`, data.errors);
        return;
      }

      // Dispatch cart update event to refresh cart UI
      document.dispatchEvent(
        new CartUpdateEvent(data, this.id, {
          source: 'cart-free-gifts',
        })
      );

      console.log(`CartFreeGifts: Removed free gift for ₹${threshold} threshold`);
    } catch (error) {
      if (error.name === 'AbortError') return;
      console.error(`CartFreeGifts: Error removing gift for ₹${threshold} threshold:`, error);
    }
  }

  /**
   * Fetches current cart data
   * @returns {Promise<Object|null>} Cart data or null if fetch fails
   */
  async #fetchCartData() {
    try {
      const response = await fetch('/cart.js');
      if (!response.ok) return null;
      return await response.json();
    } catch (error) {
      console.error('CartFreeGifts: Error fetching cart data', error);
      return null;
    }
  }

  /**
   * Gets cart section IDs for refreshing cart UI
   * @returns {string[]} Array of section IDs
   */
  #getCartSectionIds() {
    const sectionIds = new Set();
    
    // Find all cart-items-component elements
    const cartComponents = document.querySelectorAll('cart-items-component');
    cartComponents.forEach((component) => {
      if (component instanceof HTMLElement && component.dataset.sectionId) {
        sectionIds.add(component.dataset.sectionId);
      }
    });

    return Array.from(sectionIds);
  }

  /**
   * Creates a new abort controller for fetch requests
   */
  #createAbortController() {
    if (this.#activeFetch) {
      this.#activeFetch.abort();
    }
    this.#activeFetch = new AbortController();
  }
}

if (!customElements.get('cart-free-gifts-component')) {
  customElements.define('cart-free-gifts-component', CartFreeGiftsComponent);
}

