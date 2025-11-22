# AI Agent Usage Guide - Ship Design Data

## 📋 Quick Reference

When designing ships or analyzing ship capabilities for Terra Invicta, use this **optimized workflow** to minimize context usage:

### Primary Data Sources (Use These First)

1. **`../csv/Again_Unlocked_Ship_Components.csv`** (52KB, 434 components)
   - ✅ Pre-filtered to show only unlocked components
   - ✅ Concise stats format
   - ✅ Easy to parse
   - 🔄 Regenerate after research: `pwsh ../Get-UnlockedShipComponents.ps1`

2. **`ship_design_guide.md`** (32KB, 768 lines)
   - Ship design mechanics and formulas
   - AI instruction section (§0)
   - Hull selection guidance
   - Role definitions and archetypes

3. **`math.md`** (12KB, 505 lines)
   - Exact formulas for mass, Δv, acceleration
   - Armor mass calculations
   - Power and heat budgets

### Secondary References (Use Only When Needed)

4. **`current_meta.md`** (16KB, 602 lines)
   - Current community meta strategies
   - Fuel fraction targets
   - Acceleration thresholds

### ⚠️ Deprecated (Use CSV Instead)

- ~~`ship_components_tables.md`~~ (152KB) - **Replace with CSV above**

## 🤖 Recommended AI Workflow

### For Ship Design Tasks

```
1. Read: ship_design_guide.md §0 (AI usage instructions)
2. Read: ../csv/Again_Unlocked_Ship_Components.csv (available components)
3. Read: math.md (if calculations needed)
4. Reference: current_meta.md (if meta guidance needed)
```

### For Ship Analysis Tasks

```
1. Read: ../csv/Again_Unlocked_Ship_Components.csv (component stats)
2. Read: ship_design_guide.md §1-2 (performance stats, roles)
3. Read: math.md (for validation calculations)
```

## 💾 Context Savings

**Old approach:**
- Read `ship_components_tables.md` (152KB) for all 1000+ components

**New approach:**
- Read `Again_Unlocked_Ship_Components.csv` (52KB) for 434 unlocked components
- **Saves 100KB+ of context per ship design task**

## 🔄 Maintenance

After completing research projects:
```powershell
pwsh ./Get-UnlockedShipComponents.ps1
```

This updates the CSV with newly unlocked components.
