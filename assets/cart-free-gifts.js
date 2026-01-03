import { Component } from '@theme/component';
import { fetchConfig } from '@theme/utilities';
import { ThemeEvents, CartUpdateEvent, CartAddEvent, DiscountUpdateEvent, QuantitySelectorUpdateEvent } from '@theme/events';

/** @typedef {Object} GiftConfig
 * @property {string} variantId
 * @property {number} threshold
 * @property {string} tag
 */

/** @typedef {Object} CartItem
 * @property {number} variant_id
 * @property {number} [line]
 * @property {number} [final_line_price]
 * @property {number} [line_price]
 */

/** @typedef {Object} Cart
 * @property {number} total_price
 * @property {number} [item_count]
 * @property {CartItem[]} items
 */

const FREE_GIFT_CONFIG = {
  gift5000: {
    variantId: '55378709479497',
    threshold: 500000,
    tag: 'free-gift-5000',
  },
  gift8000: {
    variantId: '55378884591689',
    threshold: 800000,
    tag: 'free-gift-8000',
  },
};

class CartFreeGifts extends Component {
  #isProcessing = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  #processingTimeout = null;

  connectedCallback() {
    super.connectedCallback();
    
    document.addEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.addEventListener(ThemeEvents.quantitySelectorUpdate, this.#handleQuantityUpdate);
    
    setTimeout(() => {
      this.#checkAndUpdateGifts();
    }, 100);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    
    document.removeEventListener(ThemeEvents.cartUpdate, this.#handleCartUpdate);
    document.removeEventListener(ThemeEvents.quantitySelectorUpdate, this.#handleQuantityUpdate);
    
    if (this.#processingTimeout) {
      clearTimeout(this.#processingTimeout);
    }
  }

  /** @param {QuantitySelectorUpdateEvent} event */
  #handleQuantityUpdate = async (event) => {
    const cart = await this.#fetchCart();
    if (!cart || !cart.items) return;

    const { cartLine: line, quantity } = /** @type {QuantitySelectorUpdateEvent} */ (event).detail || {};
    if (!line || !quantity) return;

    const cartItem = cart.items[line - 1];
    if (!cartItem) return;

    const isFreeGift = this.#isFreeGiftItem(cartItem);
    
    if (isFreeGift && quantity !== 1) {
      event.preventDefault();
      event.stopPropagation();
      
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

  /** @param {CartItem} item */
  #isFreeGiftItem(item) {
    const freeGiftVariantIds = [
      FREE_GIFT_CONFIG.gift5000.variantId,
      FREE_GIFT_CONFIG.gift8000.variantId,
    ];
    
    return freeGiftVariantIds.includes(item.variant_id.toString());
  }

  /** @param {CartUpdateEvent | CartAddEvent} event */
  #handleCartUpdate = async (event) => {
    if (event.detail?.sourceId === 'cart-free-gifts' || event.detail?.data?.source === 'cart-free-gifts') {
      const cart = /** @type {Cart | undefined} */ (event.detail?.resource);
      if (cart) {
        const cartTotal = this.#calculateCartTotalExcludingFreeGifts(cart);
        this.#updateMilestones(cartTotal);
      }
      return;
    }

    if (this.#processingTimeout) {
      clearTimeout(this.#processingTimeout);
    }

    this.#processingTimeout = setTimeout(async () => {
      await this.#checkAndUpdateGifts();
      const cart = await this.#fetchCart();
      if (cart) {
        const cartTotal = this.#calculateCartTotalExcludingFreeGifts(cart);
        this.#updateMilestones(cartTotal);
      }
    }, 500);
  };

  async #checkAndUpdateGifts() {
    if (this.#isProcessing) {
      return;
    }

    this.#isProcessing = true;

    try {
      const cart = await this.#fetchCart();
      
      if (!cart) {
        this.#isProcessing = false;
        return;
      }

      const cartItemCount = /** @type {Cart} */ (cart).item_count || (cart.items ? cart.items.length : 0);
      if (!cart.items || cart.items.length === 0 || cartItemCount === 0) {
        await this.#removeAllFreeGifts(cart);
        this.#isProcessing = false;
        return;
      }

      const hasPaidItems = this.#hasPaidItems(cart);
      
      if (!hasPaidItems) {
        await this.#removeAllFreeGifts(cart);
        this.#isProcessing = false;
        return;
      }

      const cartTotal = this.#calculateCartTotalExcludingFreeGifts(cart);

      if (cartTotal <= 0) {
        await this.#removeAllFreeGifts(cart);
        this.#isProcessing = false;
        return;
      }

      await this.#handleGift(cart, FREE_GIFT_CONFIG.gift8000, cartTotal);
      await this.#handleGift(cart, FREE_GIFT_CONFIG.gift5000, cartTotal);

      this.#updateMilestones(cartTotal);

    } catch (error) {
      console.error('Error managing free gifts:', error);
    } finally {
      this.#isProcessing = false;
    }
  }

  /** @param {number} cartTotal */
  #updateMilestones(cartTotal) {
    const milestoneElements = document.querySelectorAll('.cart-milestones');
    
    milestoneElements.forEach((milestoneEl) => {
      if (!(milestoneEl instanceof HTMLElement)) return;
      
      const milestone5000 = 500000;
      const milestone8000 = 800000;
      
      const milestone5000Reached = cartTotal >= milestone5000;
      const milestone8000Reached = cartTotal >= milestone8000;
      
      let progressPercentage = 0;
      
      if (cartTotal >= milestone8000) {
        progressPercentage = 100;
      } else if (cartTotal >= milestone5000) {
        const amountAfter5000 = cartTotal - milestone5000;
        const remainingTo8000 = milestone8000 - milestone5000;
        const progressAfter5000 = (amountAfter5000 / remainingTo8000) * 50;
        progressPercentage = 50 + progressAfter5000;
        if (progressPercentage > 100) {
          progressPercentage = 100;
        }
      } else {
        progressPercentage = (cartTotal / milestone5000) * 50;
        if (progressPercentage > 50) {
          progressPercentage = 50;
        }
      }
      
      const progressFill = milestoneEl.querySelector('.cart-milestones__progress-fill');
      if (progressFill instanceof HTMLElement) {
        progressFill.style.width = `${progressPercentage}%`;
      }
      
      const milestone5000El = milestoneEl.querySelector('.cart-milestones__milestone:first-child');
      const milestone8000El = milestoneEl.querySelector('.cart-milestones__milestone:last-child');
      
      if (milestone5000El) {
        if (milestone5000Reached) {
          milestone5000El.classList.add('cart-milestones__milestone--reached');
        } else {
          milestone5000El.classList.remove('cart-milestones__milestone--reached');
        }
      }
      
      if (milestone8000El) {
        if (milestone8000Reached) {
          milestone8000El.classList.add('cart-milestones__milestone--reached');
        } else {
          milestone8000El.classList.remove('cart-milestones__milestone--reached');
        }
      }
    });
  }

  /** @param {Cart} cart */
  #hasPaidItems(cart) {
    if (!cart.items || !Array.isArray(cart.items) || cart.items.length === 0) {
      return false;
    }

    for (const item of cart.items) {
      const isFreeGift = this.#isFreeGiftItem(item);
      if (!isFreeGift) {
        return true;
      }
    }

    return false;
  }

  /** @param {Cart} cart */
  #calculateCartTotalExcludingFreeGifts(cart) {
    if (!cart.items || !Array.isArray(cart.items)) {
      return 0;
    }

    let total = 0;
    for (const item of cart.items) {
      const isFreeGift = this.#isFreeGiftItem(item);
      if (!isFreeGift) {
        const linePrice = /** @type {CartItem} */ (item).final_line_price || 
                         /** @type {CartItem} */ (item).line_price || 0;
        total += linePrice;
      }
    }

    return total;
  }

  /** @param {Cart} cart */
  async #removeAllFreeGifts(cart) {
    if (!cart.items || !Array.isArray(cart.items) || cart.items.length === 0) {
      return;
    }

    const freeGiftItems = cart.items.filter(/** @param {CartItem} item */ (item) => this.#isFreeGiftItem(item));
    
    if (freeGiftItems.length === 0) {
      return;
    }

    for (const item of freeGiftItems) {
      try {
        await this.#removeGiftFromCart(cart, item.variant_id.toString());
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error('Error removing free gift:', error);
      }
    }
  }

  /** @param {Cart} cart
   * @param {GiftConfig} giftConfig
   * @param {number} cartTotal
   */
  async #handleGift(cart, giftConfig, cartTotal) {
    const isGiftInCart = this.#isGiftInCart(cart, giftConfig.variantId);
    const shouldHaveGift = cartTotal >= giftConfig.threshold;

    if (shouldHaveGift && !isGiftInCart) {
      await this.#addGiftToCart(giftConfig.variantId);
    } else if (!shouldHaveGift && isGiftInCart) {
      await this.#removeGiftFromCart(cart, giftConfig.variantId);
    }
  }

  /** @param {Cart} cart
   * @param {string} variantId
   */
  #isGiftInCart(cart, variantId) {
    if (!cart.items || !Array.isArray(cart.items)) {
      return false;
    }

    return cart.items.some(
      (item) => /** @type {CartItem} */ (item).variant_id.toString() === variantId.toString()
    );
  }

  /** @param {string} variantId */
  async #addGiftToCart(variantId) {
    try {
      const formData = new FormData();
      formData.append('id', variantId);
      formData.append('quantity', '1');
      formData.append('properties[_auto_gift]', 'true');

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

      await this.#applyFreeGiftDiscount(variantId);

      document.dispatchEvent(
        new CartAddEvent(data, 'cart-free-gifts', {
          source: 'cart-free-gifts',
          sections: data.sections,
        })
      );

      const updatedCart = await this.#fetchCart();
      if (updatedCart) {
        const cartTotal = this.#calculateCartTotalExcludingFreeGifts(updatedCart);
        this.#updateMilestones(cartTotal);
      }

    } catch (error) {
      console.error('Error adding free gift:', error);
    }
  }

  /** @param {string} variantId */
  async #applyFreeGiftDiscount(variantId) {
    try {
      const cart = await this.#fetchCart();
      if (!cart || !cart.items) return;

      const giftItem = cart.items.find(
        /** @param {CartItem} item */ (item) => item.variant_id.toString() === variantId.toString()
      );

      if (!giftItem) return;

      const discountCode = this.#getDiscountCodeForVariant(variantId);
      
      if (discountCode) {
        const cartItemsComponents = document.querySelectorAll('cart-items-component');
        const sectionsToUpdate = new Set();
        
        cartItemsComponents.forEach((item) => {
          if (item instanceof HTMLElement && item.dataset.sectionId) {
            sectionsToUpdate.add(item.dataset.sectionId);
          }
        });

        const body = JSON.stringify({
          discount: discountCode,
          sections: Array.from(sectionsToUpdate).join(','),
        });

        const response = await fetch(Theme.routes.cart_update_url, {
          ...fetchConfig('json', { body }),
        });

        const responseText = await response.text();
        const discountData = JSON.parse(responseText);

        if (discountData && !discountData.errors) {
          document.dispatchEvent(
            new DiscountUpdateEvent(discountData, 'cart-free-gifts')
          );
        }
      }
    } catch (error) {
      console.log('Discount code not applied (may not be configured):', error);
    }
  }

  /** @param {string} variantId */
  #getDiscountCodeForVariant(variantId) {
    const discountCodeMap = {
      '55378709479497': 'FREEGIFT5000',
      '55378884591689': 'FREEGIFT8000',
    };

    return /** @type {Record<string, string>} */ (discountCodeMap)[variantId] || null;
  }

  /** @param {Cart} cart
   * @param {string} variantId
   */
  async #removeGiftFromCart(cart, variantId) {
    try {
      const giftItemIndex = cart.items.findIndex(
        (item) => /** @type {CartItem} */ (item).variant_id.toString() === variantId.toString()
      );

      if (giftItemIndex === -1) {
        return;
      }

      const giftItem = /** @type {CartItem} */ (cart.items[giftItemIndex]);

      const cartItemsComponents = document.querySelectorAll('cart-items-component');
      const sectionsToUpdate = new Set();
      
      cartItemsComponents.forEach((item) => {
        if (item instanceof HTMLElement && item.dataset.sectionId) {
          sectionsToUpdate.add(item.dataset.sectionId);
        }
      });

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

      document.dispatchEvent(
        new CartUpdateEvent(data, 'cart-free-gifts', {
          source: 'cart-free-gifts',
          itemCount: data.item_count || 0,
          sections: data.sections,
        })
      );

      const updatedCart = await this.#fetchCart();
      if (updatedCart) {
        const cartTotal = this.#calculateCartTotalExcludingFreeGifts(updatedCart);
        this.#updateMilestones(cartTotal);
      }

    } catch (error) {
      console.error('Error removing free gift:', error);
    }
  }

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
