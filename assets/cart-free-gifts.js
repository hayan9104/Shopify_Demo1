import { fetchConfig } from '@theme/utilities';
import { ThemeEvents, CartUpdateEvent } from '@theme/events';

/**
 * Free Gift Manager
 * Automatically adds/removes free gift products based on cart total thresholds
 */
class CartFreeGifts {
  constructor() {
    this.giftProducts = null;
    this.processing = false;
    this.thresholds = {
      gift5000: 500000, // ₹5,000 in cents
      gift8000: 800000, // ₹8,000 in cents
    };
    
    // Fallback variant IDs (in case tag lookup fails)
    this.fallbackVariantIds = {
      gift5000: '55378709479497', // ₹5,000 gift variant ID
      gift8000: '55378884591689', // ₹8,000 gift variant ID
    };
    
    // Track which gifts are currently in cart (by variant ID)
    this.giftsInCart = {
      gift5000: null,
      gift8000: null,
    };

    this.init();
  }

  /**
   * Initialize the free gift manager
   */
  init() {
    console.log('🎁 CartFreeGifts: Initializing...');
    
    // Load gift products on page load
    this.loadGiftProducts();
    
    // Listen for cart update events
    document.addEventListener(ThemeEvents.cartUpdate, this.handleCartUpdate.bind(this));
    console.log('🎁 CartFreeGifts: Listening for cart update events');
    
    // Also check on initial page load if cart exists
    this.checkCartOnLoad();
    
    // Also listen for CartAddEvent specifically (cart drawer uses this)
    document.addEventListener('cart:update', this.handleCartUpdate.bind(this));
    
    // Periodic check as fallback (every 2 seconds when cart is open)
    this.startPeriodicCheck();
  }

  /**
   * Start periodic check for cart updates (fallback method)
   */
  startPeriodicCheck() {
    setInterval(async () => {
      // Only check if cart drawer might be open or if we haven't processed recently
      const cartDrawer = document.querySelector('cart-drawer-component');
      if (cartDrawer && cartDrawer.hasAttribute('open')) {
        const cart = await this.fetchCart();
        if (cart && cart.item_count > 0) {
          await this.processCartGifts(cart);
        }
      }
    }, 2000);
  }

  /**
   * Check cart on initial page load
   */
  async checkCartOnLoad() {
    try {
      // Wait a bit for page to fully load
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const cart = await this.fetchCart();
      console.log('🎁 CartFreeGifts: Initial cart check', cart);
      
      if (cart && cart.item_count > 0) {
        console.log('🎁 CartFreeGifts: Cart has items, processing gifts...');
        await this.processCartGifts(cart);
      }
    } catch (error) {
      console.error('🎁 CartFreeGifts: Error checking cart on load:', error);
    }
  }

  /**
   * Load free gift products from the section endpoint
   */
  async loadGiftProducts() {
    try {
      const response = await fetch('/?section_id=free-gift-lookup');
      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const jsonText = doc.body.textContent.trim();
      
      // Remove any HTML tags that might be present
      const cleanJson = jsonText.replace(/<[^>]*>/g, '').trim();
      const loadedProducts = JSON.parse(cleanJson);
      
      // Use loaded products or fallback to hardcoded variant IDs
      this.giftProducts = {
        gift5000: {
          variantId: loadedProducts.gift5000?.variantId || this.fallbackVariantIds.gift5000,
          available: loadedProducts.gift5000?.available !== false, // Default to true if not specified
          productId: loadedProducts.gift5000?.productId || null,
          title: loadedProducts.gift5000?.title || 'Free Gift',
          price: loadedProducts.gift5000?.price || 0,
        },
        gift8000: {
          variantId: loadedProducts.gift8000?.variantId || this.fallbackVariantIds.gift8000,
          available: loadedProducts.gift8000?.available !== false, // Default to true if not specified
          productId: loadedProducts.gift8000?.productId || null,
          title: loadedProducts.gift8000?.title || 'Free Gift',
          price: loadedProducts.gift8000?.price || 0,
        },
      };
      
      // Ensure variant IDs are strings for comparison
      this.giftProducts.gift5000.variantId = String(this.giftProducts.gift5000.variantId);
      this.giftProducts.gift8000.variantId = String(this.giftProducts.gift8000.variantId);
      
      console.log('Free gift products loaded:', this.giftProducts);
    } catch (error) {
      console.error('Error loading free gift products, using fallback IDs:', error);
      // Use fallback variant IDs if lookup fails
      this.giftProducts = {
        gift5000: {
          variantId: this.fallbackVariantIds.gift5000,
          available: true,
          productId: null,
          title: 'Free Gift (₹5,000)',
          price: 0,
        },
        gift8000: {
          variantId: this.fallbackVariantIds.gift8000,
          available: true,
          productId: null,
          title: 'Free Gift (₹8,000)',
          price: 0,
        },
      };
    }
  }

  /**
   * Fetch current cart state
   */
  async fetchCart() {
    try {
      const response = await fetch(`${Theme.routes.cart_url}.js`);
      if (!response.ok) {
        throw new Error('Failed to fetch cart');
      }
      return await response.json();
    } catch (error) {
      console.error('Error fetching cart:', error);
      return null;
    }
  }

  /**
   * Handle cart update events
   * @param {any} event - The cart update event
   */
  async handleCartUpdate(event) {
    console.log('🎁 CartFreeGifts: Cart update event received', event);
    
    // Prevent infinite loops by ignoring our own updates
    if (event.detail?.data?.source === 'cart-free-gifts') {
      console.log('🎁 CartFreeGifts: Ignoring own update');
      return;
    }

    // Debounce to avoid multiple rapid calls
    if (this.processing) {
      console.log('🎁 CartFreeGifts: Already processing, skipping...');
      return;
    }

    this.processing = true;

    try {
      // Small delay to ensure cart state is updated
      await new Promise(resolve => setTimeout(resolve, 500));
      
      // Use cart data from event if available, otherwise fetch
      let cart = event.detail?.resource;
      if (!cart || !cart.items) {
        cart = await this.fetchCart();
      }
      
      console.log('🎁 CartFreeGifts: Processing cart', cart);
      
      if (cart) {
        await this.processCartGifts(cart);
      }
    } catch (error) {
      console.error('🎁 CartFreeGifts: Error handling cart update:', error);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Process cart and add/remove gifts based on total
   * @param {any} cart - The cart object
   */
  async processCartGifts(cart) {
    console.log('🎁 CartFreeGifts: Processing cart gifts...', {
      cartTotal: cart.total_price,
      itemCount: cart.item_count,
      items: cart.items
    });
    
    // Ensure gift products are loaded
    if (!this.giftProducts) {
      console.log('🎁 CartFreeGifts: Gift products not loaded, loading now...');
      await this.loadGiftProducts();
    }

    if (!this.giftProducts) {
      console.warn('🎁 CartFreeGifts: Free gift products not loaded yet');
      return;
    }

    const cartTotal = /** @type {number} */ (cart.total_price);
    console.log('🎁 CartFreeGifts: Cart total:', cartTotal, 'cents (₹' + (cartTotal / 100) + ')');
    console.log('🎁 CartFreeGifts: Thresholds:', this.thresholds);
    
    // Update tracking of which gifts are in cart
    this.updateGiftsInCart(cart);
    console.log('🎁 CartFreeGifts: Gifts in cart:', this.giftsInCart);

    // Check ₹8,000 threshold first (higher threshold)
    if (cartTotal >= this.thresholds.gift8000) {
      console.log('🎁 CartFreeGifts: Cart total >= ₹8,000, adding both gifts');
      await this.ensureGiftInCart('gift8000', cart);
      await this.ensureGiftInCart('gift5000', cart);
    } 
    // Check ₹5,000 threshold
    else if (cartTotal >= this.thresholds.gift5000) {
      console.log('🎁 CartFreeGifts: Cart total >= ₹5,000, adding gift5000');
      await this.ensureGiftInCart('gift5000', cart);
      await this.removeGiftFromCart('gift8000', cart);
    } 
    // Below both thresholds
    else {
      console.log('🎁 CartFreeGifts: Cart total < ₹5,000, removing all gifts');
      await this.removeGiftFromCart('gift5000', cart);
      await this.removeGiftFromCart('gift8000', cart);
    }
  }

  /**
   * Update tracking of which gifts are currently in cart
   * @param {any} cart - The cart object
   */
  updateGiftsInCart(cart) {
    if (!cart.items || !this.giftProducts) return;

    const items = /** @type {any[]} */ (cart.items);
    const gift5000VariantId = this.giftProducts.gift5000?.variantId;
    const gift8000VariantId = this.giftProducts.gift8000?.variantId;

    // Find gifts in cart by variant ID (convert to string for comparison)
    this.giftsInCart.gift5000 = items.find(
      /** @param {any} item */
      (item) => String(item.variant_id) === String(gift5000VariantId)
    ) || null;

    this.giftsInCart.gift8000 = items.find(
      /** @param {any} item */
      (item) => String(item.variant_id) === String(gift8000VariantId)
    ) || null;
  }

  /**
   * Ensure a gift is in the cart (add if not present)
   * @param {'gift5000' | 'gift8000'} giftKey - The gift key
   * @param {any} cart - The cart object
   */
  async ensureGiftInCart(giftKey, cart) {
    if (!this.giftProducts) return;
    const gift = /** @type {any} */ (this.giftProducts)[giftKey];
    
    if (!gift || !gift.variantId) {
      console.warn(`Gift ${giftKey} not configured`);
      return;
    }

    // Check availability (skip if explicitly false, but allow if undefined/true)
    if (gift.available === false) {
      console.warn(`Gift ${giftKey} is not available`);
      return;
    }

    // Check if gift is already in cart
    const giftInCart = /** @type {any} */ (this.giftsInCart)[giftKey];
    
    if (giftInCart && giftInCart.quantity > 0) {
      return; // Already in cart
    }

    // Add gift to cart
    try {
      console.log(`🎁 CartFreeGifts: Attempting to add gift ${giftKey} with variant ID: ${gift.variantId}`);
      
      const formData = new FormData();
      formData.append('id', gift.variantId);
      formData.append('quantity', '1');
      
      // Mark as auto-added gift using properties
      formData.append('properties[_auto_gift]', giftKey);
      const threshold = /** @type {any} */ (this.thresholds)[giftKey];
      if (threshold) {
        formData.append('properties[_gift_threshold]', threshold.toString());
      }

      console.log('🎁 CartFreeGifts: Sending request to:', Theme.routes.cart_add_url);
      
      const fetchCfg = fetchConfig('javascript', { body: formData });
      const response = await fetch(Theme.routes.cart_add_url, {
        ...fetchCfg,
        headers: {
          ...fetchCfg.headers,
          Accept: 'application/json',
        },
      });

      const result = await response.json();
      console.log('🎁 CartFreeGifts: Add to cart response:', result);

      if (result.status) {
        console.error('🎁 CartFreeGifts: Error adding free gift:', result.message, result);
        return;
      }

      // Dispatch cart update event
      document.dispatchEvent(
        new CartUpdateEvent(result, 'cart-free-gifts', {
          source: 'cart-free-gifts',
          itemCount: result.item_count,
        })
      );

      console.log(`✅ CartFreeGifts: Free gift ${giftKey} (variant: ${gift.variantId}) successfully added to cart!`);
    } catch (error) {
      console.error(`❌ CartFreeGifts: Error adding free gift ${giftKey}:`, error);
    }
  }

  /**
   * Remove a gift from cart if it was auto-added
   * @param {'gift5000' | 'gift8000'} giftKey - The gift key
   * @param {any} cart - The cart object
   */
  async removeGiftFromCart(giftKey, cart) {
    const giftInCart = /** @type {any} */ (this.giftsInCart)[giftKey];
    
    if (!giftInCart || !this.giftProducts) {
      return; // Not in cart or products not loaded
    }

    try {
      // Find the line number (1-based index) for this item
      const gift = /** @type {any} */ (this.giftProducts)[giftKey];
      if (!gift) return;
      
      const giftVariantId = String(gift.variantId);
      const items = /** @type {any[]} */ (cart.items);
      const lineNumber = items.findIndex(
        /** @param {any} item */
        (item) => String(item.variant_id) === giftVariantId
      ) + 1;
      
      if (lineNumber === 0) {
        return; // Item not found
      }
      
      const body = JSON.stringify({
        line: lineNumber,
        quantity: 0,
        sections: 'main-cart',
        sections_url: window.location.pathname,
      });

      const response = await fetch(Theme.routes.cart_change_url, {
        ...fetchConfig('json', { body }),
      });

      const responseText = await response.text();
      const result = JSON.parse(responseText);

      if (result.errors) {
        console.error('Error removing free gift:', result.errors);
        return;
      }

      // Dispatch cart update event
      document.dispatchEvent(
        new CartUpdateEvent(result, 'cart-free-gifts', {
          source: 'cart-free-gifts',
          itemCount: result.item_count,
          sections: result.sections,
        })
      );

      console.log(`Free gift ${giftKey} (variant: ${giftVariantId}) removed from cart`);
    } catch (error) {
      console.error(`Error removing free gift ${giftKey}:`, error);
    }
  }
}

// Initialize on page load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new CartFreeGifts();
  });
} else {
  new CartFreeGifts();
}

