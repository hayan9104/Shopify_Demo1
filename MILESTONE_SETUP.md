# Milestone Rewards System - Setup Guide

## Step 1: Milestone Configuration Storage ✅

The milestone rewards system uses a **hybrid storage approach**:

### 1. **Theme Settings** (Admin-Editable)
Located in: `config/settings_schema.json`

These settings appear in **Shopify Admin → Online Store → Themes → Customize → Theme Settings → Milestone Rewards**

- **Enable Milestone Rewards**: Toggle to enable/disable the feature
- **Show Progress Bar**: Display milestone progress in cart
- **Show Success Banner**: Show banner when milestone is reached
- **Free Item Tag**: Tag used to identify free items

### 2. **Milestone Definitions** (Code-Based)
Located in: `snippets/milestone-config.liquid`

This file contains the actual milestone definitions (thresholds, products, etc.)

### 3. **JSON Config File** (For Reference)
Located in: `config/milestone-rewards.json`

This is a reference file showing the structure. The actual config is in the Liquid snippet.

---

## How to Modify Milestones

### Option 1: Edit the Liquid Snippet (Recommended)

1. Open `snippets/milestone-config.liquid`
2. Find the milestone definitions section
3. Modify the variables:

```liquid
{% liquid
  comment %} Milestone 1: ₹5999 - Steel Shaker {% endcomment %}
  assign milestone_1_threshold = 599900  <!-- Amount in paisa (5999 * 100) -->
  assign milestone_1_product_handle = 'steel-shaker'  <!-- Product handle from Shopify -->
  assign milestone_1_variant_id = ''  <!-- Leave blank for default variant -->
  assign milestone_1_display_name = 'Steel Shaker'  <!-- Name shown to customers -->
  assign milestone_1_order = 1  <!-- Display order -->
%}
```

**Important Notes:**
- Thresholds are in **paisa** (smallest currency unit). ₹5999 = 599900 paisa
- Product handles are the URL-friendly names (found in product URL)
- To add more milestones, copy the pattern and increment the number (milestone_6, milestone_7, etc.)

### Option 2: Use Theme Settings (Future Enhancement)

Currently, milestones are defined in code. In the future, we can add a settings interface to make them admin-editable.

---

## How to Access Milestone Data

### In Liquid Templates:

```liquid
{% render 'milestone-config' %}

{% if milestone_rewards_enabled %}
  <!-- Access individual milestones -->
  Threshold: {{ milestone_1_threshold }}
  Product: {{ milestone_1_product_handle }}
  Display Name: {{ milestone_1_display_name }}
{% endif %}
```

### In JavaScript:

```javascript
// The config is automatically output as JSON in the page
const configElement = document.getElementById('milestone-rewards-config');
const milestoneConfig = JSON.parse(configElement.textContent);

console.log(milestoneConfig.enabled);
console.log(milestoneConfig.milestones);
```

---

## Current Milestone Configuration

Based on your image, the system is configured with:

1. **₹5,999** → Free Steel Shaker
2. **₹14,999** → Free BCAA
3. **₹24,999** → Free ISORich
4. **₹30,000** → Free ₹1K Amazon Gift Card
5. **₹100,000** → Free ₹10K Amazon Gift Card

---

## Next Steps

1. ✅ **Step 1 Complete**: Milestone storage configured
2. **Step 2**: Identify/create reward products in Shopify
3. **Step 3**: Update product handles in `milestone-config.liquid` to match your actual products
4. **Step 4**: Implement cart calculation logic
5. **Step 5**: Build the milestone progress UI
6. **Step 6**: Implement auto-add/remove functionality

---

## Finding Product Handles

To find a product's handle:
1. Go to Shopify Admin → Products
2. Click on a product
3. Look at the URL: `yourstore.myshopify.com/admin/products/[PRODUCT_ID]`
4. Or check the product page URL: `yourstore.com/products/[PRODUCT_HANDLE]`

The handle is the last part of the URL (e.g., `steel-shaker`, `bcaa`)

---

## Troubleshooting

**Q: How do I change the currency?**
A: The thresholds are in paisa (smallest unit). For ₹5999, use 599900. For $59.99, use 5999 (cents).

**Q: Can I use variant IDs?**
A: Yes! If a product has variants, find the variant ID in Shopify admin and set `milestone_X_variant_id = '123456789'`

**Q: How do I add more milestones?**
A: Copy a milestone block and increment the number (milestone_6, milestone_7, etc.). Also add it to the JSON array in the script tag.

---

## File Structure

```
config/
  ├── milestone-rewards.json (reference file)
  └── settings_schema.json (theme settings)

snippets/
  └── milestone-config.liquid (main configuration)
```

