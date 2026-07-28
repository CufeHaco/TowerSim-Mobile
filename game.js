/**
 * TowerSim Mobile — A complete SimTower-inspired tower management game
 * Mobile-first HTML5 Canvas implementation
 */

(() => {
  "use strict";

  // ============================================================
  // CONSTANTS & CONFIG
  // ============================================================
  const FLOOR_HEIGHT = 48;
  const FLOOR_WIDTH = 280;
  const SLOT_WIDTH = 56;          // 5 slots per floor
  const MAX_FLOORS = 60;
  const MIN_FLOOR = -4;           // basements
  const ELEVATOR_CAPACITY = 8;
  const DAY_LENGTH_MS = 90000;    // 90 seconds real time = 1 day
  const TICK_MS = 50;

  const COSTS = {
    office: 25000,
    condo: 45000,
    hotel: 35000,
    restaurant: 20000,
    elevator: 15000,   // per floor of shaft
    stairs: 5000,
    demolish: 2000
  };

  const RENTS = {
    office: 2800,      // per day when occupied (scaled for fun)
    condo: 0,          // sold once
    hotel: 3200,       // per occupied room night
    restaurant: 1400
  };

  const CAPACITY = {
    office: 6,
    condo: 3,
    hotel: 4,
    restaurant: 8
  };

  const COLORS = {
    sky: "#0a1628",
    ground: "#1a2a1a",
    lobby: "#3d2b1f",
    office: "#2a3a4a",
    condo: "#3a2a4a",
    hotel: "#4a3a2a",
    restaurant: "#4a2a2a",
    empty: "#12181f",
    elevator: "#1e3a5f",
    stairs: "#2a2a1a",
    wall: "#30363d",
    text: "#e6edf3",
    money: "#3fb950",
    danger: "#f85149"
  };

  // ============================================================
  // GAME STATE
  // ============================================================
  let canvas, ctx;
  let money = 50000;
  let day = 1;
  let timeOfDay = 8.0;          // 0-24 hours
  let population = 0;
  let stars = 1;
  let gameRunning = false;
  let paused = false;
  let selectedTool = "select";
  let cameraY = 0;              // scroll offset (higher = looking up)
  let targetCameraY = 0;
  let lastTick = 0;
  let messageTimer = 0;

  // Floors: Map floorNumber -> Floor object
  // Floor: { type, slots: [Slot], elevators: [], stairs: bool, tenants: [] }
  const floors = new Map();

  // Elevator shafts: array of { id, minFloor, maxFloor, cars: [] }
  const elevators = [];
  let nextElevId = 1;

  // Sims / Agents
  const sims = [];
  let nextSimId = 1;

  // Touch / input
  let isDragging = false;
  let lastTouchY = 0;
  let lastTouchX = 0;
  let touchStartTime = 0;
  let pendingPlaceFloor = null;

  // ============================================================
  // FLOOR & SLOT STRUCTURE
  // ============================================================
  function createFloor(num) {
    const slots = [];
    for (let i = 0; i < 5; i++) {
      slots.push({ type: "empty", occupied: 0, capacity: 0, happiness: 100, sold: false });
    }
    return {
      num,
      slots,
      hasStairs: false,
      elevatorShafts: [], // indices of elevators serving this floor
      dirt: 0
    };
  }

  function ensureFloor(num) {
    if (!floors.has(num)) {
      floors.set(num, createFloor(num));
    }
    return floors.get(num);
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================
  function init() {
    canvas = document.getElementById("gameCanvas");
    ctx = canvas.getContext("2d");
    resize();

    // Starting lobby
    const lobby = ensureFloor(0);
    for (let i = 0; i < 5; i++) {
      lobby.slots[i] = { type: "lobby", occupied: 0, capacity: 0, happiness: 100, sold: false };
    }

    // Pre-create nearby floors so player can build immediately
    for (let f = -2; f <= 8; f++) {
      ensureFloor(f);
    }

    cameraY = 0;
    targetCameraY = 0;

    setupEvents();
    updateHUD();
    showMessage("Welcome! Build offices above the lobby to start.");

    // Check for save
    const save = localStorage.getItem("towersim_save");
    if (save) {
      document.getElementById("btn-continue").style.display = "block";
    }

    requestAnimationFrame(gameLoop);
  }

  function resize() {
    const wrap = document.getElementById("canvas-wrap");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = wrap.clientWidth * dpr;
    canvas.height = wrap.clientHeight * dpr;
    canvas.style.width = wrap.clientWidth + "px";
    canvas.style.height = wrap.clientHeight + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  // ============================================================
  // EVENTS
  // ============================================================
  function setupEvents() {
    window.addEventListener("resize", resize);

    // Toolbar
    document.querySelectorAll(".tool").forEach(btn => {
      btn.addEventListener("click", () => {
        const tool = btn.dataset.tool;
        if (tool === "pause") {
          if (gameRunning) {
            paused = true;
            document.getElementById("pause-menu").classList.remove("hidden");
          }
          return;
        }
        document.querySelectorAll(".tool").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
        selectedTool = tool;
        showMessage(toolName(selectedTool));
      });
    });

    // Start screen
    document.getElementById("btn-start").addEventListener("click", startNewGame);
    document.getElementById("btn-continue").addEventListener("click", loadGame);
    document.getElementById("btn-resume").addEventListener("click", () => {
      paused = false;
      document.getElementById("pause-menu").classList.add("hidden");
    });
    document.getElementById("btn-save").addEventListener("click", saveGame);
    document.getElementById("btn-new").addEventListener("click", () => {
      if (confirm("Start a new tower? Current progress will be lost.")) {
        localStorage.removeItem("towersim_save");
        location.reload();
      }
    });
    document.getElementById("btn-continue-play").addEventListener("click", () => {
      document.getElementById("win-screen").classList.add("hidden");
    });

    // Canvas touch / mouse
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mouseup", onMouseUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    // Pause on visibility
    document.addEventListener("visibilitychange", () => {
      if (document.hidden && gameRunning) paused = true;
    });
  }

  function toolName(t) {
    const names = {
      select: "Pan / Select — drag to scroll tower",
      office: "Office — $25,000 (6 workers, daily rent)",
      condo: "Condo — $45,000 (sold for profit + residents)",
      hotel: "Hotel — $35,000 (4 guests, nightly income)",
      restaurant: "Restaurant — $20,000 (lunch crowd)",
      elevator: "Elevator — $15,000 per floor (extend by tapping adjacent)",
      stairs: "Stairs — $5,000 (short range, 3 floors max)",
      demolish: "Demolish — $2,000"
    };
    return names[t] || t;
  }

  // ============================================================
  // INPUT HANDLERS
  // ============================================================
  function getTouchPos(e) {
    const rect = canvas.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return {
      x: t.clientX - rect.left,
      y: t.clientY - rect.top
    };
  }

  function onTouchStart(e) {
    e.preventDefault();
    const pos = getTouchPos(e);
    isDragging = true;
    lastTouchY = pos.y;
    lastTouchX = pos.x;
    touchStartTime = Date.now();
  }

  function onTouchMove(e) {
    e.preventDefault();
    if (!isDragging) return;
    const pos = getTouchPos(e);
    const dy = pos.y - lastTouchY;
    targetCameraY -= dy;
    lastTouchY = pos.y;
    lastTouchX = pos.x;
    clampCamera();
  }

  function onTouchEnd(e) {
    e.preventDefault();
    const wasDrag = Math.abs(Date.now() - touchStartTime) > 180 || Math.abs(lastTouchY - (e.changedTouches?.[0]?.clientY || 0)) > 12;
    isDragging = false;

    if (!wasDrag && selectedTool !== "select" && gameRunning) {
      const pos = getTouchPos(e.changedTouches ? e.changedTouches[0] : e);
      tryPlace(pos.x, pos.y);
    }
  }

  function onMouseDown(e) {
    isDragging = true;
    lastTouchY = e.clientY;
    lastTouchX = e.clientX;
    touchStartTime = Date.now();
  }

  function onMouseMove(e) {
    if (!isDragging) return;
    const dy = e.clientY - lastTouchY;
    targetCameraY -= dy;
    lastTouchY = e.clientY;
    clampCamera();
  }

  function onMouseUp(e) {
    const dt = Date.now() - touchStartTime;
    isDragging = false;
    if (dt < 200 && selectedTool !== "select" && gameRunning) {
      const rect = canvas.getBoundingClientRect();
      tryPlace(e.clientX - rect.left, e.clientY - rect.top);
    }
  }

  function onWheel(e) {
    e.preventDefault();
    targetCameraY += e.deltaY * 0.5;
    clampCamera();
  }

  function clampCamera() {
    const maxY = (MAX_FLOORS - 2) * FLOOR_HEIGHT;
    const minY = (MIN_FLOOR - 1) * FLOOR_HEIGHT - 100;
    targetCameraY = Math.max(minY, Math.min(maxY, targetCameraY));
  }

  // ============================================================
  // PLACEMENT
  // ============================================================
  function screenToFloor(sy) {
    const viewH = canvas.height / (window.devicePixelRatio || 1);
    const worldY = cameraY + (viewH / 2 - sy);
    return Math.round(worldY / FLOOR_HEIGHT);
  }

  function screenToSlot(sx) {
    const viewW = canvas.width / (window.devicePixelRatio || 1);
    const left = (viewW - FLOOR_WIDTH) / 2;
    const rel = sx - left;
    if (rel < 0 || rel > FLOOR_WIDTH) return -1;
    return Math.floor(rel / SLOT_WIDTH);
  }

  function tryPlace(sx, sy) {
    const floorNum = screenToFloor(sy);
    const slot = screenToSlot(sx);

    if (floorNum < MIN_FLOOR || floorNum > MAX_FLOORS) {
      showMessage("Out of buildable range");
      return;
    }

    ensureFloor(floorNum);
    const floor = floors.get(floorNum);

    if (selectedTool === "demolish") {
      demolish(floorNum, slot);
      return;
    }

    if (selectedTool === "elevator") {
      placeElevator(floorNum, slot);
      return;
    }

    if (selectedTool === "stairs") {
      placeStairs(floorNum);
      return;
    }

    // Room types need a slot
    if (slot < 0 || slot > 4) {
      showMessage("Tap inside the building");
      return;
    }

    if (floor.slots[slot].type !== "empty") {
      showMessage("Slot occupied — demolish first");
      return;
    }

    // Lobby is only on 0
    if (floorNum === 0) {
      showMessage("Lobby floor is fixed");
      return;
    }

    const cost = COSTS[selectedTool];
    if (money < cost) {
      showMessage("Not enough money!");
      return;
    }

    // Place room
    floor.slots[slot] = {
      type: selectedTool,
      occupied: 0,
      capacity: CAPACITY[selectedTool] || 0,
      happiness: 100,
      sold: false
    };
    money -= cost;

    // Condo is sold immediately for profit
    if (selectedTool === "condo") {
      const sale = 65000 + Math.floor(Math.random() * 15000);
      money += sale;
      floor.slots[slot].sold = true;
      showMessage(`Condo sold for $${sale.toLocaleString()}!`);
    } else {
      showMessage(`${selectedTool} built on floor ${floorNum}`);
    }

    updateHUD();
    checkStars();
  }

  function placeElevator(floorNum, slot) {
    if (slot < 0 || slot > 4) {
      showMessage("Tap a slot for the shaft");
      return;
    }

    // Look for nearby elevator on same slot (adjacent or overlapping)
    let shaft = elevators.find(e => e.slot === slot && floorNum >= e.minFloor - 1 && floorNum <= e.maxFloor + 1);

    if (shaft) {
      // Extend existing shaft
      const oldMin = shaft.minFloor;
      const oldMax = shaft.maxFloor;
      const newMin = Math.min(shaft.minFloor, floorNum);
      const newMax = Math.max(shaft.maxFloor, floorNum);
      const added = (newMax - newMin) - (oldMax - oldMin);
      const cost = COSTS.elevator * Math.max(1, added);
      if (money < cost) {
        showMessage("Not enough money to extend ($" + cost.toLocaleString() + ")");
        return;
      }
      money -= cost;
      shaft.minFloor = newMin;
      shaft.maxFloor = newMax;
      showMessage(`Elevator now serves floors ${shaft.minFloor}–${shaft.maxFloor}`);
    } else {
      // New shaft
      const cost = COSTS.elevator;
      if (money < cost) {
        showMessage("Not enough money ($15,000)");
        return;
      }
      const fl = ensureFloor(floorNum);
      if (fl.slots[slot].type !== "empty" && fl.slots[slot].type !== "elevator") {
        showMessage("Slot must be empty for new shaft");
        return;
      }
      money -= cost;
      shaft = {
        id: nextElevId++,
        slot,
        minFloor: floorNum,
        maxFloor: floorNum,
        cars: [{
          floor: floorNum,
          target: floorNum,
          direction: 0,
          passengers: [],
          state: "idle",
          doorTimer: 0
        }]
      };
      elevators.push(shaft);
      showMessage(`New elevator on floor ${floorNum}. Tap adjacent floors to extend it.`);
    }

    // Ensure every floor in the shaft has the elevator slot marked
    for (let f = shaft.minFloor; f <= shaft.maxFloor; f++) {
      const fl = ensureFloor(f);
      fl.slots[slot] = { type: "elevator", occupied: 0, capacity: 0, happiness: 100, sold: false };
      if (!fl.elevatorShafts) fl.elevatorShafts = [];
      if (!fl.elevatorShafts.includes(shaft.id)) fl.elevatorShafts.push(shaft.id);
    }
    updateHUD();
  }

  function placeStairs(floorNum) {
    const cost = COSTS.stairs;
    if (money < cost) {
      showMessage("Not enough money ($5,000)");
      return;
    }
    const fl = ensureFloor(floorNum);
    if (fl.hasStairs) {
      showMessage("Stairs already on this floor");
      return;
    }
    money -= cost;
    fl.hasStairs = true;
    // Also mark the floor above for better connectivity
    const above = ensureFloor(floorNum + 1);
    if (!above.hasStairs) {
      // Free bonus connection feel
      above.hasStairs = true;
    }
    showMessage(`Stairs installed on floor ${floorNum} (connects ±3 floors)`);
    updateHUD();
  }

  function demolish(floorNum, slot) {
    if (floorNum === 0) {
      showMessage("Cannot demolish lobby");
      return;
    }
    const fl = floors.get(floorNum);
    if (!fl) return;

    if (slot >= 0 && slot <= 4) {
      const s = fl.slots[slot];
      if (s.type === "empty") {
        showMessage("Nothing to demolish");
        return;
      }
      if (money < COSTS.demolish) {
        showMessage("Need $2,000 to demolish");
        return;
      }
      money -= COSTS.demolish;

      // If elevator, remove shaft contribution
      if (s.type === "elevator") {
        const shaft = elevators.find(e => e.slot === slot && floorNum >= e.minFloor && floorNum <= e.maxFloor);
        if (shaft) {
          // Shrink or remove
          if (floorNum === shaft.minFloor) shaft.minFloor++;
          else if (floorNum === shaft.maxFloor) shaft.maxFloor--;
          else {
            // Split is complex — just remove whole for simplicity
            elevators.splice(elevators.indexOf(shaft), 1);
          }
          if (shaft.minFloor > shaft.maxFloor) {
            const idx = elevators.indexOf(shaft);
            if (idx >= 0) elevators.splice(idx, 1);
          }
        }
      }

      fl.slots[slot] = { type: "empty", occupied: 0, capacity: 0, happiness: 100, sold: false };
      showMessage("Demolished");
      updateHUD();
    }
  }

  // ============================================================
  // SIMS / AGENTS
  // ============================================================
  function spawnSims() {
    // Offices need workers during day
    floors.forEach((fl, num) => {
      fl.slots.forEach((slot, si) => {
        if (slot.type === "office" && slot.occupied < slot.capacity) {
          // Higher chance in morning rush, lower otherwise during work hours
          let chance = 0;
          if (timeOfDay > 7.5 && timeOfDay < 9.5) chance = 0.045;
          else if (timeOfDay > 9.5 && timeOfDay < 17) chance = 0.008;
          if (Math.random() < chance) {
            createSim("worker", 0, num, si);
          }
        }
        if (slot.type === "condo" && slot.sold && slot.occupied < slot.capacity) {
          // Populate residents once after sale
          if (slot.occupied === 0) {
            for (let i = 0; i < slot.capacity; i++) {
              createSim("resident", num, num, si);
            }
            slot.occupied = slot.capacity;
          }
        }
        if (slot.type === "hotel" && slot.occupied < slot.capacity) {
          if (Math.random() < 0.02 && (timeOfDay > 15 || timeOfDay < 11)) {
            createSim("guest", 0, num, si);
          }
        }
        if (slot.type === "restaurant" && timeOfDay > 11.5 && timeOfDay < 14) {
          if (Math.random() < 0.04) {
            createSim("customer", 0, num, si);
          }
        }
      });
    });
  }

  function createSim(role, startFloor, destFloor, destSlot) {
    const sim = {
      id: nextSimId++,
      role,
      floor: startFloor,
      x: 20 + Math.random() * (FLOOR_WIDTH - 40),
      destFloor,
      destSlot,
      state: "walking", // walking, waiting, riding, arrived, leaving
      waitTime: 0,
      elevatorId: null,
      happiness: 100,
      color: role === "worker" ? "#58a6ff" : role === "resident" ? "#d2a8ff" : role === "guest" ? "#f2cc60" : "#3fb950"
    };
    sims.push(sim);
    population = sims.filter(s => s.state !== "leaving").length;
    return sim;
  }

  function updateSims(dt) {
    for (let i = sims.length - 1; i >= 0; i--) {
      const sim = sims[i];
      if (sim.state === "leaving") {
        sims.splice(i, 1);
        continue;
      }

      // Happiness decay if waiting
      if (sim.state === "waiting") {
        sim.waitTime += dt;
        if (sim.waitTime > 12) { // 12 seconds real wait ~ long time
          sim.happiness -= 15 * dt;
          if (sim.happiness < 20) {
            // Leave angry
            sim.state = "leaving";
            showMessage("A tenant left due to long wait!");
            // Free the slot occupancy
            const fl = floors.get(sim.destFloor);
            if (fl && fl.slots[sim.destSlot]) {
              fl.slots[sim.destSlot].occupied = Math.max(0, fl.slots[sim.destSlot].occupied - 1);
            }
            continue;
          }
        }
      }

      if (sim.state === "walking") {
        // Move toward elevator or stairs or destination if same floor
        if (sim.floor === sim.destFloor) {
          // Arrive at destination
          const fl = floors.get(sim.floor);
          if (fl && fl.slots[sim.destSlot] && fl.slots[sim.destSlot].occupied < fl.slots[sim.destSlot].capacity) {
            fl.slots[sim.destSlot].occupied++;
            sim.state = "arrived";
            // Stay for a while then leave
            setTimeout(() => {
              if (sim.state === "arrived") {
                sim.state = "leaving";
                const f = floors.get(sim.floor);
                if (f) f.slots[sim.destSlot].occupied = Math.max(0, f.slots[sim.destSlot].occupied - 1);
              }
            }, 8000 + Math.random() * 10000);
          } else {
            sim.state = "leaving";
          }
        } else {
          // Need transport
          // Prefer elevator
          const shaft = findElevatorFor(sim.floor, sim.destFloor);
          if (shaft) {
            sim.state = "waiting";
            sim.elevatorId = shaft.id;
            sim.waitTime = 0;
            // Move x toward elevator slot
            const elevX = shaft.slot * SLOT_WIDTH + SLOT_WIDTH / 2;
            sim.x += (elevX - sim.x) * 0.08;
          } else if (canUseStairs(sim.floor, sim.destFloor)) {
            // Walk stairs (slow)
            const dir = Math.sign(sim.destFloor - sim.floor);
            sim.floor += dir * 0.02 * (dt * 60); // slow climb
            if (Math.abs(sim.floor - Math.round(sim.floor)) < 0.05) {
              sim.floor = Math.round(sim.floor);
            }
          } else {
            // Stuck — slowly get unhappy
            sim.happiness -= 5 * dt;
            if (sim.happiness < 10) sim.state = "leaving";
          }
        }
      }
    }
    population = sims.filter(s => s.state !== "leaving").length;
  }

  function findElevatorFor(from, to) {
    return elevators.find(e => from >= e.minFloor && from <= e.maxFloor && to >= e.minFloor && to <= e.maxFloor);
  }

  function canUseStairs(from, to) {
    if (Math.abs(from - to) > 3) return false;
    const step = Math.sign(to - from);
    for (let f = from; f !== to; f += step) {
      const fl = floors.get(Math.round(f));
      if (!fl || !fl.hasStairs) return false;
    }
    return true;
  }

  // ============================================================
  // ELEVATOR LOGIC
  // ============================================================
  function updateElevators(dt) {
    elevators.forEach(shaft => {
      shaft.cars.forEach(car => {
        if (car.state === "idle" || car.state === "doors") {
          // Look for waiting passengers
          const waiting = sims.filter(s =>
            s.state === "waiting" &&
            s.elevatorId === shaft.id &&
            Math.abs(s.floor - car.floor) < 0.3
          );

          if (waiting.length > 0 && car.passengers.length < ELEVATOR_CAPACITY) {
            // Board
            const board = waiting.slice(0, ELEVATOR_CAPACITY - car.passengers.length);
            board.forEach(s => {
              s.state = "riding";
              car.passengers.push(s);
            });
            car.state = "doors";
            car.doorTimer = 0.8;
          } else if (car.passengers.length > 0) {
            // Go to first passenger dest
            const dest = car.passengers[0].destFloor;
            car.target = dest;
            car.direction = Math.sign(dest - car.floor);
            car.state = "moving";
          } else {
            // Look for calls in range
            const calls = sims.filter(s =>
              s.state === "waiting" &&
              s.elevatorId === shaft.id &&
              s.floor >= shaft.minFloor && s.floor <= shaft.maxFloor
            );
            if (calls.length > 0) {
              // Nearest
              calls.sort((a, b) => Math.abs(a.floor - car.floor) - Math.abs(b.floor - car.floor));
              car.target = Math.round(calls[0].floor);
              car.direction = Math.sign(car.target - car.floor);
              car.state = "moving";
            }
          }
        }

        if (car.state === "doors") {
          car.doorTimer -= dt;
          if (car.doorTimer <= 0) {
            // Drop off anyone at this floor
            const staying = [];
            car.passengers.forEach(s => {
              if (Math.abs(s.destFloor - car.floor) < 0.5) {
                s.floor = car.floor;
                s.state = "walking";
              } else {
                staying.push(s);
              }
            });
            car.passengers = staying;
            car.state = "idle";
          }
        }

        if (car.state === "moving") {
          const speed = 1.8; // floors per second
          car.floor += car.direction * speed * dt;
          if ((car.direction > 0 && car.floor >= car.target) ||
              (car.direction < 0 && car.floor <= car.target)) {
            car.floor = car.target;
            car.state = "doors";
            car.doorTimer = 0.6;
            // Drop passengers
            const staying = [];
            car.passengers.forEach(s => {
              if (Math.abs(s.destFloor - car.floor) < 0.5) {
                s.floor = Math.round(car.floor);
                s.state = "walking";
              } else {
                staying.push(s);
              }
            });
            car.passengers = staying;
          }
        }
      });
    });
  }

  // ============================================================
  // ECONOMY & TIME
  // ============================================================
  function updateEconomy(dt) {
    // Advance time
    const hoursPerSec = 24 / (DAY_LENGTH_MS / 1000);
    timeOfDay += hoursPerSec * dt;

    if (timeOfDay >= 24) {
      timeOfDay -= 24;
      day++;
      collectRent();
      checkStars();
      showMessage(`Day ${day} begins`);
    }
  }

  function collectRent() {
    let income = 0;
    floors.forEach(fl => {
      fl.slots.forEach(slot => {
        if (slot.type === "office" && slot.occupied > 0) {
          income += RENTS.office * (slot.occupied / slot.capacity);
        }
        if (slot.type === "hotel" && slot.occupied > 0) {
          income += RENTS.hotel * (slot.occupied / slot.capacity);
        }
        if (slot.type === "restaurant" && slot.occupied > 0) {
          income += RENTS.restaurant;
        }
        // Condo already sold
      });
    });
    income = Math.floor(income);
    money += income;
    if (income > 0) showMessage(`Daily income: $${income.toLocaleString()}`);
    updateHUD();
  }

  function checkStars() {
    let newStars = 1;
    if (population >= 20) newStars = 2;
    if (population >= 50) newStars = 3;
    if (population >= 100) newStars = 4;
    if (population >= 200) newStars = 5;

    // Also count floors
    let built = 0;
    floors.forEach(fl => {
      fl.slots.forEach(s => { if (s.type !== "empty" && s.type !== "lobby") built++; });
    });
    if (built >= 15) newStars = Math.max(newStars, 2);
    if (built >= 40) newStars = Math.max(newStars, 3);

    if (newStars > stars) {
      stars = newStars;
      showMessage(`⭐ Tower upgraded to ${stars} stars!`);
      if (stars >= 5) {
        document.getElementById("win-text").textContent = `You built a legendary ${stars}-star tower with ${population} people!`;
        document.getElementById("win-screen").classList.remove("hidden");
      }
      updateHUD();
    }
  }

  // ============================================================
  // RENDERING
  // ============================================================
  function draw() {
    const viewW = canvas.width / (window.devicePixelRatio || 1);
    const viewH = canvas.height / (window.devicePixelRatio || 1);

    // Smooth camera
    cameraY += (targetCameraY - cameraY) * 0.18;

    // Background
    ctx.fillStyle = COLORS.sky;
    ctx.fillRect(0, 0, viewW, viewH);

    // Stars / night tint
    if (timeOfDay < 6 || timeOfDay > 20) {
      ctx.fillStyle = "rgba(0,0,20,0.35)";
      ctx.fillRect(0, 0, viewW, viewH);
    }

    const centerX = viewW / 2;
    const buildingLeft = centerX - FLOOR_WIDTH / 2;

    // Draw floors from bottom of view to top
    const minVisible = Math.floor((cameraY - viewH / 2) / FLOOR_HEIGHT) - 1;
    const maxVisible = Math.ceil((cameraY + viewH / 2) / FLOOR_HEIGHT) + 1;

    for (let f = minVisible; f <= maxVisible; f++) {
      if (f < MIN_FLOOR - 1 || f > MAX_FLOORS + 1) continue;
      const fl = floors.get(f) || { slots: Array(5).fill({ type: "empty" }), hasStairs: false };
      const y = viewH / 2 - (f * FLOOR_HEIGHT - cameraY);

      // Floor background
      let bg = COLORS.empty;
      if (f === 0) bg = COLORS.lobby;
      else if (f < 0) bg = "#0f1a12";
      ctx.fillStyle = bg;
      ctx.fillRect(buildingLeft, y - FLOOR_HEIGHT + 2, FLOOR_WIDTH, FLOOR_HEIGHT - 2);

      // Floor line
      ctx.strokeStyle = COLORS.wall;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(buildingLeft, y);
      ctx.lineTo(buildingLeft + FLOOR_WIDTH, y);
      ctx.stroke();

      // Slots
      for (let s = 0; s < 5; s++) {
        const slot = fl.slots[s] || { type: "empty" };
        const sx = buildingLeft + s * SLOT_WIDTH;
        drawSlot(sx, y - FLOOR_HEIGHT + 2, SLOT_WIDTH - 1, FLOOR_HEIGHT - 4, slot, f);
      }

      // Floor number
      ctx.fillStyle = "rgba(255,255,255,0.25)";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(f === 0 ? "L" : String(f), buildingLeft - 6, y - FLOOR_HEIGHT / 2 + 4);

      // Stairs indicator
      if (fl.hasStairs) {
        ctx.fillStyle = "#8b7355";
        ctx.fillRect(buildingLeft + FLOOR_WIDTH - 10, y - FLOOR_HEIGHT + 8, 6, FLOOR_HEIGHT - 16);
      }
    }

    // Draw elevator cars
    elevators.forEach(shaft => {
      shaft.cars.forEach(car => {
        const y = viewH / 2 - (car.floor * FLOOR_HEIGHT - cameraY);
        const sx = buildingLeft + shaft.slot * SLOT_WIDTH + 4;
        // Car
        ctx.fillStyle = "#1f6feb";
        ctx.fillRect(sx, y - FLOOR_HEIGHT + 6, SLOT_WIDTH - 10, FLOOR_HEIGHT - 14);
        ctx.strokeStyle = "#58a6ff";
        ctx.lineWidth = 2;
        ctx.strokeRect(sx, y - FLOOR_HEIGHT + 6, SLOT_WIDTH - 10, FLOOR_HEIGHT - 14);
        // Passengers count
        if (car.passengers.length > 0) {
          ctx.fillStyle = "#fff";
          ctx.font = "11px sans-serif";
          ctx.textAlign = "center";
          ctx.fillText(car.passengers.length, sx + (SLOT_WIDTH - 10) / 2, y - FLOOR_HEIGHT / 2 + 4);
        }
      });
    });

    // Draw sims
    sims.forEach(sim => {
      if (sim.state === "riding" || sim.state === "leaving") return;
      const y = viewH / 2 - (sim.floor * FLOOR_HEIGHT - cameraY);
      const sx = buildingLeft + sim.x;
      ctx.beginPath();
      ctx.arc(sx, y - 14, 5, 0, Math.PI * 2);
      ctx.fillStyle = sim.color;
      ctx.fill();
      // Waiting indicator
      if (sim.state === "waiting") {
        ctx.fillStyle = "#f85149";
        ctx.fillRect(sx - 3, y - 28, 6, 3);
      }
    });

    // Ground / lobby base
    const groundY = viewH / 2 - (0 * FLOOR_HEIGHT - cameraY);
    if (groundY > 0 && groundY < viewH + 50) {
      ctx.fillStyle = COLORS.ground;
      ctx.fillRect(0, groundY, viewW, viewH);
      // Sidewalk
      ctx.fillStyle = "#2a2a2a";
      ctx.fillRect(buildingLeft - 40, groundY, FLOOR_WIDTH + 80, 12);
    }

    // Building outline
    ctx.strokeStyle = "#484f58";
    ctx.lineWidth = 2;
    const topY = viewH / 2 - ((MAX_FLOORS + 1) * FLOOR_HEIGHT - cameraY);
    const botY = viewH / 2 - ((MIN_FLOOR - 1) * FLOOR_HEIGHT - cameraY);
    ctx.strokeRect(buildingLeft - 1, Math.min(topY, botY), FLOOR_WIDTH + 2, Math.abs(botY - topY));
  }

  function drawSlot(x, y, w, h, slot, floorNum) {
    let color = COLORS.empty;
    let label = "";
    switch (slot.type) {
      case "lobby": color = COLORS.lobby; label = "LOBBY"; break;
      case "office": color = COLORS.office; label = "OFF"; break;
      case "condo": color = COLORS.condo; label = "HOME"; break;
      case "hotel": color = COLORS.hotel; label = "HOTEL"; break;
      case "restaurant": color = COLORS.restaurant; label = "FOOD"; break;
      case "elevator": color = COLORS.elevator; label = "ELV"; break;
      default: return;
    }

    ctx.fillStyle = color;
    ctx.fillRect(x + 1, y + 1, w - 2, h - 2);

    // Occupancy bar
    if (slot.capacity > 0) {
      const pct = slot.occupied / slot.capacity;
      ctx.fillStyle = pct > 0.8 ? "#3fb950" : pct > 0.4 ? "#d29922" : "#484f58";
      ctx.fillRect(x + 3, y + h - 6, (w - 6) * pct, 3);
    }

    // Label
    ctx.fillStyle = "rgba(255,255,255,0.7)";
    ctx.font = "9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(label, x + w / 2, y + h / 2 + 3);
  }

  // ============================================================
  // HUD & UI
  // ============================================================
  function updateHUD() {
    document.getElementById("money").textContent = "$" + money.toLocaleString();
    document.getElementById("pop").textContent = population;
    document.getElementById("stars").textContent = stars;
    document.getElementById("day").textContent = "Day " + day;
    const h = Math.floor(timeOfDay);
    const m = Math.floor((timeOfDay % 1) * 60);
    document.getElementById("time").textContent = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  function showMessage(txt) {
    const el = document.getElementById("message");
    el.textContent = txt;
    el.classList.add("show");
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => el.classList.remove("show"), 2800);
  }

  // ============================================================
  // SAVE / LOAD
  // ============================================================
  function saveGame() {
    const data = {
      money, day, timeOfDay, population, stars,
      floors: Array.from(floors.entries()),
      elevators,
      nextElevId, nextSimId
    };
    localStorage.setItem("towersim_save", JSON.stringify(data));
    showMessage("Game saved!");
  }

  function loadGame() {
    const raw = localStorage.getItem("towersim_save");
    if (!raw) return;
    try {
      const data = JSON.parse(raw);
      money = data.money;
      day = data.day;
      timeOfDay = data.timeOfDay;
      population = data.population || 0;
      stars = data.stars;
      floors.clear();
      data.floors.forEach(([k, v]) => floors.set(Number(k), v));
      elevators.length = 0;
      data.elevators.forEach(e => elevators.push(e));
      nextElevId = data.nextElevId || 1;
      nextSimId = data.nextSimId || 1;
      sims.length = 0; // sims not saved for simplicity
      document.getElementById("start-screen").classList.add("hidden");
      gameRunning = true;
      updateHUD();
      showMessage("Game loaded!");
    } catch (e) {
      showMessage("Failed to load save");
    }
  }

  function startNewGame() {
    document.getElementById("start-screen").classList.add("hidden");
    gameRunning = true;
    showMessage("Build your first office above the lobby!");
  }

  // ============================================================
  // MAIN LOOP
  // ============================================================
  function gameLoop(timestamp) {
    const dt = Math.min((timestamp - lastTick) / 1000, 0.1);
    lastTick = timestamp;

    if (gameRunning && !paused) {
      updateEconomy(dt);
      spawnSims();
      updateSims(dt);
      updateElevators(dt);
      updateHUD();
    }

    draw();
    requestAnimationFrame(gameLoop);
  }

  // Boot
  window.addEventListener("load", init);
})();
