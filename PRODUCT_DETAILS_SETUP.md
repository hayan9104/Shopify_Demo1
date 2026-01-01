# Product Details Section Setup Guide

## Overview
The Product Details section now supports product-specific content through metafields. This allows each product to have unique detail items while keeping the same section structure.

## How It Works

The section will automatically:
1. **Check for product metafields first** - If a product has the configured metafield, it will use that content
2. **Fall back to section blocks** - If no metafield is found, it will use the section blocks configured in the theme editor

## Setting Up Product Metafields

### Step 1: Create the Metafield Definition

1. Go to **Settings > Custom data > Products** in your Shopify admin
2. Click **Add definition**
3. Configure as follows:
   - **Name**: Product Details (or any name you prefer)
   - **Namespace and key**: `custom.product_details` (or customize in section settings)
   - **Type**: **List of list items**
   - **List item definition**: Create a list item with these fields:
     - **Icon** (type: File reference - Image)
     - **Text** (type: Single line text)

### Step 2: Add Content to Each Product

1. Go to any product in your Shopify admin
2. Scroll down to the **Metafields** section
3. Find your **Product Details** metafield
4. Click **Add item** to add detail entries
5. For each item:
   - Upload or select an icon image
   - Enter the detail text
6. Repeat for all products that need unique content

### Step 3: Configure Section Settings (Optional)

In the theme editor, you can customize:
- **Content Source**: Choose "Auto" (recommended), "Metafields Only", or "Blocks Only"
- **Metafield Namespace**: Usually "custom" (default)
- **Metafield Key**: Usually "product_details" (default)

## Benefits

✅ Each product can have unique detail content  
✅ Section appears on all product pages automatically  
✅ Easy to manage content per product in Shopify admin  
✅ Falls back to section blocks if metafields aren't set  
✅ No need to edit theme code for each product

## Example

**Product A** might have:
- Icon: Shipping icon → "Free shipping on orders over $50"
- Icon: Return icon → "30-day return policy"
- Icon: Quality icon → "Premium quality materials"

**Product B** might have:
- Icon: Warranty icon → "2-year warranty included"
- Icon: Support icon → "24/7 customer support"
- Icon: Gift icon → "Perfect gift for any occasion"

Both products use the same section, but display different content!

