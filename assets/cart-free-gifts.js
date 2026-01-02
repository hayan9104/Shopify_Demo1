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
    this.giftTags = {
      gift5000: 'free-gift-5000',
      gift8000: 'free-gift-8000',
    };
    
    // Optional: Specific variant IDs - set these if you want to use specific variants
    // If these are set, they will be used as fallback if tag lookup fails
    // Set to null to use tag-based lookup only
    this.fallbackVariantIds = {
      gift5000: 55378709479497, // Variant ID for ₹5,000 gift
      gift8000: 55378884591689, // Variant ID for ₹8,000 gift
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
    // Load gift products on page load
    this.loadGiftProducts();
    
    // Listen for cart update events
    document.addEventListener(ThemeEvents.cartUpdate, this.handleCartUpdate.bind(this));
    
    // Also check on initial page load if cart exists
    this.checkCartOnLoad();
  }

  /**
   * Check cart on initial page load
   */
  async checkCartOnLoad() {
    try {
      const cart = await this.fetchCart();
      if (cart && cart.item_count > 0) {
        await this.processCartGifts(cart);
      }
    } catch (error) {
      console.error('Error checking cart on load:', error);
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
      this.giftProducts = JSON.parse(cleanJson);
      
      // If tag-based lookup didn't find products but fallback IDs are set, use them
      if (this.fallbackVariantIds.gift5000) {
        if (!this.giftProducts.gift5000?.variantId) {
          this.giftProducts.gift5000 = {
            variantId: this.fallbackVariantIds.gift5000,
            available: true,
            productId: null,
            title: 'Free Gift (₹5,000)',
            price: 0,
          };
        } else if (this.giftProducts.gift5000.variantId !== this.fallbackVariantIds.gift5000) {
          // Override with specific variant ID if provided
          this.giftProducts.gift5000.variantId = this.fallbackVariantIds.gift5000;
        }
      }
      
      if (this.fallbackVariantIds.gift8000) {
        if (!this.giftProducts.gift8000?.variantId) {
          this.giftProducts.gift8000 = {
            variantId: this.fallbackVariantIds.gift8000,
            available: true,
            productId: null,
            title: 'Free Gift (₹8,000)',
            price: 0,
          };
        } else if (this.giftProducts.gift8000.variantId !== this.fallbackVariantIds.gift8000) {
          // Override with specific variant ID if provided
          this.giftProducts.gift8000.variantId = this.fallbackVariantIds.gift8000;
        }
      }
      
      console.log('Free gift products loaded:', this.giftProducts);
    } catch (error) {
      console.error('Error loading free gift products:', error);
      
      // If tag lookup fails completely and fallback IDs are set, use them
      if (this.fallbackVariantIds.gift5000 || this.fallbackVariantIds.gift8000) {
        this.giftProducts = {
          gift5000: this.fallbackVariantIds.gift5000 ? {
            variantId: this.fallbackVariantIds.gift5000,
            available: true,
            productId: null,
            title: 'Free Gift (₹5,000)',
            price: 0,
          } : null,
          gift8000: this.fallbackVariantIds.gift8000 ? {
            variantId: this.fallbackVariantIds.gift8000,
            available: true,
            productId: null,
            title: 'Free Gift (₹8,000)',
            price: 0,
          } : null,
        };
        console.log('Using fallback variant IDs:', this.giftProducts);
      } else {
        // Retry after a delay if no fallback IDs
        setTimeout(() => this.loadGiftProducts(), 2000);
      }
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
   */
  async handleCartUpdate(event) {
    // Prevent infinite loops by ignoring our own updates
    if (event.detail?.data?.source === 'cart-free-gifts') {
      return;
    }

    // Debounce to avoid multiple rapid calls
    if (this.processing) {
      return;
    }

    this.processing = true;

    try {
      // Small delay to ensure cart state is updated
      await new Promise(resolve => setTimeout(resolve, 300));
      
      const cart = await this.fetchCart();
      if (cart) {
        await this.processCartGifts(cart);
      }
    } catch (error) {
      console.error('Error handling cart update:', error);
    } finally {
      this.processing = false;
    }
  }

  /**
   * Process cart and add/remove gifts based on total
   */
  async processCartGifts(cart) {
    // Ensure gift products are loaded
    if (!this.giftProducts) {
      await this.loadGiftProducts();
    }

    if (!this.giftProducts) {
      console.warn('Free gift products not loaded yet');
      return;
    }

    const cartTotal = cart.total_price;
    
    // Update tracking of which gifts are in cart
    this.updateGiftsInCart(cart);

    // Check ₹8,000 threshold first (higher threshold)
    if (cartTotal >= this.thresholds.gift8000) {
      await this.ensureGiftInCart('gift8000', cart);
      await this.ensureGiftInCart('gift5000', cart);
    } 
    // Check ₹5,000 threshold
    else if (cartTotal >= this.thresholds.gift5000) {
      await this.ensureGiftInCart('gift5000', cart);
      await this.removeGiftFromCart('gift8000', cart);
    } 
    // Below both thresholds
    else {
      await this.removeGiftFromCart('gift5000', cart);
      await this.removeGiftFromCart('gift8000', cart);
    }
  }

  /**
   * Update tracking of which gifts are currently in cart
   */
  updateGiftsInCart(cart) {
    if (!cart.items) return;

    const gift5000VariantId = this.giftProducts?.gift5000?.variantId;
    const gift8000VariantId = this.giftProducts?.gift8000?.variantId;

    // Find gifts in cart by variant ID
    this.giftsInCart.gift5000 = cart.items.find(
      item => item.variant_id === gift5000VariantId
    ) || null;

    this.giftsInCart.gift8000 = cart.items.find(
      item => item.variant_id === gift8000VariantId
    ) || null;
  }

  /**
   * Ensure a gift is in the cart (add if not present)
   */
  async ensureGiftInCart(giftKey, cart) {
    const gift = this.giftProducts[giftKey];
    
    if (!gift || !gift.variantId || !gift.available) {
      return;
    }

    // Check if gift is already in cart
    const giftInCart = this.giftsInCart[giftKey];
    
    if (giftInCart) {
      // Gift is already in cart, check if it was manually removed
      // If quantity is 0, it means it was removed, so don't re-add automatically
      if (giftInCart.quantity > 0) {
        return; // Already in cart
      }
    }

    // Add gift to cart
    try {
      const formData = new FormData();
      formData.append('id', gift.variantId);
      formData.append('quantity', '1');
      
      // Mark as auto-added gift using properties
      formData.append('properties[_auto_gift]', giftKey);
      formData.append('properties[_gift_threshold]', this.thresholds[giftKey].toString());

      const response = await fetch(Theme.routes.cart_add_url, {
        ...fetchConfig('javascript', { body: formData }),
        headers: {
          ...fetchConfig('javascript', { body: formData }).headers,
          Accept: 'application/json',
        },
      });

      const result = await response.json();

      if (result.status) {
        console.error('Error adding free gift:', result.message);
        return;
      }

      // Dispatch cart update event
      document.dispatchEvent(
        new CartUpdateEvent(result, 'cart-free-gifts', {
          source: 'cart-free-gifts',
          itemCount: result.item_count,
        })
      );

      console.log(`Free gift ${giftKey} added to cart`);
    } catch (error) {
      console.error(`Error adding free gift ${giftKey}:`, error);
    }
  }

  /**
   * Remove a gift from cart if it was auto-added
   */
  async removeGiftFromCart(giftKey, cart) {
    const giftInCart = this.giftsInCart[giftKey];
    
    if (!giftInCart) {
      return; // Not in cart
    }

    // Only remove if it was auto-added (has the _auto_gift property)
    // Note: We can't check properties via cart API, so we'll remove if it matches the variant
    // In a production scenario, you might want to track this differently
    
    try {
      // Find the line number (1-based index) for this item
      const lineNumber = cart.items.findIndex(item => item.variant_id === giftInCart.variant_id) + 1;
      
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

      console.log(`Free gift ${giftKey} removed from cart`);
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
