# TowerSim Mobile — Complete SimTower-Inspired Game

A fully playable mobile-first tower building & management simulation inspired by the classic *SimTower*.

**Live demo / Play:** Open `index.html` directly in any modern browser (or use GitHub Pages).

## How to Play

1. Open `index.html` in any modern mobile or desktop browser (Chrome, Safari, Firefox).
2. Tap **Start New Tower**.
3. You begin with a Lobby on floor 0 and $50,000.
4. Select a building tool from the bottom toolbar.
5. **Drag** the tower view up/down to scroll.
6. **Tap** an empty slot on a floor to place the selected item.

### Building Tips

- **Offices** generate daily rent when workers arrive (morning rush).
- **Condos** are sold immediately for a large profit and house permanent residents.
- **Hotels** bring overnight guests and income.
- **Restaurants** attract lunch crowds.
- **Elevators** are critical! Place on a slot, then tap the floors above/below on the *same slot* to extend the shaft. People will only travel efficiently if an elevator connects their origin and destination.
- **Stairs** allow short trips (up to 3 floors) without elevators.
- Demolish mistakes for a small fee.

### Goals

- Grow population to unlock higher star ratings (1 → 5 stars).
- Reach 5 stars for the victory screen (you can keep playing).
- Manage elevator traffic so tenants don’t leave angry.

### Controls (Mobile)

- Touch & drag = pan the tower
- Tap = place selected building
- Toolbar icons = select tool
- ⏸️ = Pause / Save / New Game

### Save System

Progress auto-saves to browser localStorage when you use the Pause menu → Save.

## Technical Notes

- Pure HTML5 + Canvas + Vanilla JS
- No external dependencies
- Optimized for portrait mobile screens
- Touch + mouse + wheel support
- Day cycle: ~90 real seconds = 1 in-game day

Enjoy building your vertical empire!

---

Built with ❤️ as a complete playable SimTower clone for mobile.