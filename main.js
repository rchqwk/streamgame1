const CONFIG = {
  cols: 75,
  rows: 60,
  tips: [
    "Type 'skibidi' for dance block!",
    "Every LIKE breaks a block!",
    "SUB for MEGA explosion!",
    "Type '69' for nice pattern!",
    "Type 'boom' for 3x3 explosion!",
    "Try 'rainbow' for gradients!",
  ],
  comboWindowMs: 5000,
  likePopupMs: 1000,
  sfxMaxConcurrent: 3,
  blockTileCandidates: [16, 32, 64],
  renderScale: 1,
};

function randInt(n) { return Math.floor(Math.random() * n); }
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
function now() { return performance.now(); }
function getYouTubeApiKey() {
  try {
    const params = new URLSearchParams(location.search);
    const fromQuery = params.get('ytKey');
    if (fromQuery) localStorage.setItem('yt_api_key', fromQuery);
    const saved = localStorage.getItem('yt_api_key');
    const fallback = 'AIzaSyDpLeIDgegfbBdlMOM12Ut0QXUP5wKy4r4';
    const key = fromQuery || saved || fallback;
    if (!saved && key === fallback) localStorage.setItem('yt_api_key', key);
    return key;
  } catch {
    return 'AIzaSyDpLeIDgegfbBdlMOM12Ut0QXUP5wKy4r4';
  }
}

class Sound {
  constructor() {
    this.ctx = null;
    this.active = 0;
    this.muted = false;
  }
  ensure() {
    if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
  }
  beep(freq = 440, durMs = 120, type = 'sine', volume = 0.08) {
    if (this.muted) return;
    this.ensure();
    if (this.active >= CONFIG.sfxMaxConcurrent) return;
    this.active++;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime);
    gain.gain.value = volume;
    osc.connect(gain).connect(this.ctx.destination);
    osc.start();
    setTimeout(() => { osc.stop(); this.active--; }, durMs);
  }
}

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = canvas.width;
    this.height = canvas.height;
    this.grid = [];
    this.colors = [
      '#ff5c5c', '#43e97b', '#3b82f6', '#f59e0b', '#b388ff', '#ff77c8', '#ffffff', '#111827'
    ];
    this.actions = [];
    this.particles = [];
    this.overlayTextEl = document.getElementById('overlayText');
    this.stageWrapper = document.getElementById('stageWrapper');
    this.sound = new Sound();
    this.stats = {
      likes: 0,
      subs: 0,
      members: 0,
      broken: 0,
      streak: 0,
    };
    this.recentCommands = [];
    this.recentSubs = [];
    this.topChatters = new Map();
    this.comboState = { lastCmd: null, count: 0, lastTime: 0, multiplier: 1 };
    this.userCooldowns = new Map();
    this._initGrid();
    this._bindUI();
    // Schedule TNT falls at randomized like intervals (5–20)
    this._nextTntAt = this.stats.likes + (5 + randInt(16));
    this._startLoop();
  }

  _initGrid() {
    // Terrain stratification: top soil, then stone with ore; rare colorful blocks sprinkled
    this._soilLayers = Math.max(3, Math.floor(CONFIG.rows * 0.08)); // ~8% of rows as soil
    for (let y = 0; y < CONFIG.rows; y++) {
      this.grid.push(this._generateTerrainRow(y));
    }
  }

  // Generate a terrain row based on vertical position: soil at top, stone/ore deeper
  _generateTerrainRow(y) {
    const row = [];
    const soilColor = '#8b5a2b'; // brown soil
    const stoneColor = '#9ca3af'; // gray stone
    const oreColor = '#6b7280'; // darker gray for ore base
    const restColors = this.colors.filter(c => c !== stoneColor && c !== oreColor && c !== soilColor);
    const isSoil = y < (this._soilLayers || 4);
    for (let x = 0; x < CONFIG.cols; x++) {
      if (isSoil) {
        row.push({ alive: true, color: soilColor, glow: 0, type: 'soil', textureIndex: null });
      } else {
        // Ground: mostly stone, some ore, rare colorful blocks
        const r = Math.random();
        if (r < 0.14) {
          // ore (dotted)
          row.push({ alive: true, color: oreColor, glow: 0, type: 'ore', textureIndex: null });
        } else if (r < 0.88) {
          // stone
          row.push({ alive: true, color: stoneColor, glow: 0, type: 'stone', textureIndex: null });
        } else {
          // rare colorful block
          const clr = restColors.length ? restColors[randInt(restColors.length)] : this.colors[randInt(this.colors.length)];
          row.push({ alive: true, color: clr, glow: 0, type: 'normal' });
        }
      }
    }
    return row;
  }

  _bindUI() {
    const sendBtn = document.getElementById('sendCommandBtn');
    const cmdInput = document.getElementById('commandInput');
    const userInput = document.getElementById('usernameInput');
    const likeBtn = document.getElementById('likeBtn');
    const subBtn = document.getElementById('subBtn');
    const memberBtn = document.getElementById('memberBtn');
    const nukeBtn = document.getElementById('nukeBtn');
    const muteToggle = document.getElementById('muteToggle');
    const controlsIsland = document.getElementById('controlsIsland');
    const controlsMinBtn = document.getElementById('controlsMinBtn');
    // TNT variant buttons
    const tntButtons = [];
    for (let i=0;i<8;i++) {
      const el = document.getElementById('tntVar'+i);
      if (el) tntButtons.push({ i, el });
    }

    muteToggle.addEventListener('change', () => { this.sound.muted = muteToggle.checked; });

    // Restore collapsed state for Dev Tools
    try {
      const collapsed = localStorage.getItem('controlsCollapsed');
      if (collapsed === 'true') controlsIsland.classList.add('collapsed');
    } catch {}
    controlsMinBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      controlsIsland.classList.toggle('collapsed');
      try { localStorage.setItem('controlsCollapsed', controlsIsland.classList.contains('collapsed')); } catch {}
    });
    sendBtn.addEventListener('click', () => {
      const u = userInput.value.trim() || 'guest';
      const c = cmdInput.value.trim();
      if (!c) return;
      this.enqueueCommand(u, c);
      cmdInput.value = '';
    });
    cmdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') sendBtn.click(); });

    likeBtn.addEventListener('click', () => this.onLike());
    subBtn.addEventListener('click', () => this.onSub('NewSubscriber'));
    memberBtn.addEventListener('click', () => this.onMember('NewMember'));
    nukeBtn?.addEventListener('click', () => this.dropNuke());
    // Bind TNT variant buttons
    for (const { i, el } of tntButtons) {
      el.addEventListener('click', () => this.spawnTntVariant(i));
    }

    // rotating tips
    let tipIdx = 0;
    setInterval(() => {
      tipIdx = (tipIdx + 1) % CONFIG.tips.length;
      document.getElementById('tipText').textContent = CONFIG.tips[tipIdx];
    }, 10000);
  }

  // Spawn a TNT with a specific spriteIndex to select its finale variant
  spawnTntVariant(idx) {
    const col = randInt(CONFIG.cols);
    this._announce(`TNT variant ${idx}`);
    this._spawnBody({ type: 'tnt_fall', sheet: 'tnt', col, color: '#ff4444', radiusFactor: 0.7, vx: (Math.random()-0.5)*120, vy: 0, spriteIndex: idx });
    this.sound.beep(160, 160, 'square');
  }

  enqueueCommand(user, text) {
    const cool = this.userCooldowns.get(user) || 0;
    const t = now();
    if (t - cool < 2000) return; // spam protection
    this.userCooldowns.set(user, t);
    const normalized = text.toLowerCase();
    this.recentCommands.unshift(`${user}: ${text}`);
    if (this.recentCommands.length > 5) this.recentCommands.pop();
    this._updateRecentCommands();
    this._bumpTopChatter(user);

    // combo and multiplier
    this._updateCombo(normalized);

    const handler = this._commandHandlers()[normalized] || this._fallbackHandler(normalized);
    const mult = this.comboState.multiplier;
    this.actions.push(() => handler(mult));
  }

  onLike() {
    this.stats.likes++;
    this._showLikePopup('+1');
    const x = randInt(CONFIG.cols), y = randInt(CONFIG.rows);
    this._breakOne(x, y, true);
    this._updateHud();
    this.sound.beep(600, 100, 'triangle');
    this._incStreak();
  }

  onSub(name) {
    this.stats.subs++;
    this._updateHud();
    this._announce(`${name} subscribed!`);
    // Spawn a TNT fall for the new subscriber (no label)
    this._spawnBody({ type: 'tnt_fall', sheet: 'tnt' });
    this._addMemorialBlock(name);
    this.sound.beep(300, 250, 'square');
    this._pushRecentSub(name);
    this._incStreak();
  }

  onMember(name) {
    this.stats.members++;
    this._updateHud();
    this._announce(`${name} became a Member!`);
    // Spawn a TNT fall for the new member (no label)
    this._spawnBody({ type: 'tnt_fall', sheet: 'tnt' });
    this.sound.beep(200, 350, 'sawtooth');
    this._incStreak();
  }

  _updateHud() {
    document.getElementById('likeCount').textContent = this.stats.likes;
    document.getElementById('brokenCount').textContent = this.stats.broken;
    document.getElementById('comboLabel').textContent = this.comboState.multiplier > 1 ? `COMBO x${this.comboState.multiplier}` : '—';
    document.getElementById('mostUsed').textContent = this._mostUsedCommand() || '—';
    document.getElementById('streakCounter').textContent = this.stats.streak;
  }

  _updateRecentCommands() {
    const ul = document.getElementById('recentList');
    ul.innerHTML = '';
    this.recentCommands.forEach(item => {
      const li = document.createElement('li');
      li.textContent = item;
      ul.appendChild(li);
    });
  }

  _pushRecentSub(name) {
    this.recentSubs.unshift(name);
    if (this.recentSubs.length > 6) this.recentSubs.pop();
    const ul = document.getElementById('recentSubs');
    ul.innerHTML = '';
    this.recentSubs.forEach(n => {
      const li = document.createElement('li');
      li.textContent = n;
      ul.appendChild(li);
    });
  }

  _bumpTopChatter(user) {
    this.topChatters.set(user, (this.topChatters.get(user) || 0) + 1);
    const arr = Array.from(this.topChatters.entries()).sort((a,b) => b[1]-a[1]).slice(0,6);
    const ul = document.getElementById('topChatters');
    ul.innerHTML = '';
    arr.forEach(([name,count]) => {
      const li = document.createElement('li');
      li.textContent = `${name} (${count})`;
      ul.appendChild(li);
    });
  }

  _mostUsedCommand() {
    const freq = new Map();
    this.recentCommands.forEach(line => {
      const cmd = line.split(':')[1]?.trim()?.toLowerCase();
      if (!cmd) return;
      freq.set(cmd, (freq.get(cmd) || 0) + 1);
    });
    let best = null, bestCount = 0;
    for (const [k,v] of freq.entries()) if (v>bestCount) { best=k; bestCount=v; }
    return best;
  }

  _updateCombo(cmd) {
    const t = now();
    if (this.comboState.lastCmd === cmd && (t - this.comboState.lastTime) <= CONFIG.comboWindowMs) {
      this.comboState.count++;
      this.comboState.lastTime = t;
    } else {
      this.comboState.lastCmd = cmd;
      this.comboState.count = 1;
      this.comboState.lastTime = t;
    }
    if (this.comboState.count >= 5) {
      this.comboState.multiplier = 5;
      this._announce('COMBO X5!');
    } else if (this.comboState.count >= 3) {
      this.comboState.multiplier = 3;
      this._announce('COMBO X3!');
    } else {
      this.comboState.multiplier = 1;
    }
  }

  _announce(text, color = '#fff') {
    const el = this.overlayTextEl;
    el.textContent = text;
    el.style.color = color;
    el.style.opacity = '1';
    setTimeout(() => { el.style.opacity = '0'; }, 1500);
  }

  _showLikePopup(text) {
    const container = document.getElementById('likePopups');
    const el = document.createElement('div');
    el.className = 'popup';
    el.textContent = text;
    container.appendChild(el);
    setTimeout(() => { el.remove(); }, CONFIG.likePopupMs);
  }

  _cellSize() {
    const pad = 40; // internal padding inside canvas
    const availW = this.width - pad*2;
    const availH = this.height - pad*2;
    const cellW = Math.floor(availW / CONFIG.cols);
    const cellH = Math.floor(availH / CONFIG.rows);
    const size = Math.min(cellW, cellH);
    const offX = Math.floor((this.width - size * CONFIG.cols) / 2);
    const offY = Math.floor((this.height - size * CONFIG.rows) / 2);
    return { size, offX, offY };
  }

  _drawGrid() {
    const { size, offX, offY } = this._cellSize();
    const ctx = this.ctx;
    ctx.clearRect(0,0,this.width,this.height);

    for (let y=0;y<CONFIG.rows;y++) {
      for (let x=0;x<CONFIG.cols;x++) {
        const c = this.grid[y][x];
        const px = offX + x*size;
        const py = offY + y*size;
        if (!c.alive) {
          ctx.fillStyle = 'rgba(255,255,255,0.05)';
          ctx.fillRect(px, py, size, size);
          continue;
        }
        ctx.fillStyle = c.color;
        ctx.fillRect(px, py, size, size);
        if (c.glow > 0) {
          ctx.strokeStyle = `rgba(255,255,255,${c.glow})`;
          ctx.lineWidth = 2;
          ctx.strokeRect(px+1, py+1, size-2, size-2);
          c.glow = Math.max(0, c.glow - 0.02);
        }
      }
    }

    // particles
    this.particles.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.life -= 1;
      ctx.globalAlpha = Math.max(0, p.life / p.lifeMax);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y, p.size, p.size);
      ctx.globalAlpha = 1;
    });
    this.particles = this.particles.filter(p => p.life > 0);
  }

  _spawnParticles(cx, cy, count=24, color='#fff') {
    const { size, offX, offY } = this._cellSize();
    const px = offX + cx*size + size/2;
    const py = offY + cy*size + size/2;
    for (let i=0;i<count;i++) {
      this.particles.push({
        x: px, y: py,
        vx: (Math.random()-0.5)*4,
        vy: (Math.random()-0.5)*4,
        size: Math.random()*3+1,
        life: 40,
        lifeMax: 40,
        color
      });
    }
  }

  _breakOne(x, y, withParticles=false) {
    const cell = this.grid[y]?.[x];
    if (!cell || !cell.alive) return;
    cell.alive = false;
    cell.glow = 0.9;
    this.stats.broken++;
    if (withParticles) this._spawnParticles(x, y, 32, cell.color);
    this._detachFloatingClusters?.();
  }

  _addBlock(x, y, color, type='normal') {
    const cell = this.grid[y]?.[x];
    if (!cell) return;
    cell.alive = true; cell.color = color; cell.type = type; cell.glow = 0.9;
    cell.textureIndex = null; // ensure a fresh texture assignment
  }

  _explosion(cx, cy, radius) {
    for (let dy=-radius; dy<=radius; dy++) {
      for (let dx=-radius; dx<=radius; dx++) {
        const x=cx+dx, y=cy+dy;
        if (x<0||y<0||x>=CONFIG.cols||y>=CONFIG.rows) continue;
        this._breakOne(x,y,true);
      }
    }
    this._detachFloatingClusters?.();
  }

  _crossExplosion(cx, cy, len) {
    for (let i=-len; i<=len; i++) {
      const x1 = clamp(cx+i,0,CONFIG.cols-1), y1 = cy;
      const x2 = cx, y2 = clamp(cy+i,0,CONFIG.rows-1);
      this._breakOne(x1,y1,true);
      this._breakOne(x2,y2,true);
    }
  }

  _circleBreak(cx, cy, r) {
    for (let y=0;y<CONFIG.rows;y++) {
      for (let x=0;x<CONFIG.cols;x++) {
        const dx = x-cx, dy=y-cy; if (Math.sqrt(dx*dx+dy*dy) <= r) this._breakOne(x,y,true);
      }
    }
  }

  _heartPattern(x0,y0,size,color='#ff77c8') {
    // approximate heart: two circles + triangle bottom
    for (let y=-size; y<=size*2; y++) {
      for (let x=-size*2; x<=size*2; x++) {
        const X = x0 + x, Y = y0 + y;
        if (X<0||Y<0||X>=CONFIG.cols||Y>=CONFIG.rows) continue;
        const left = (x+size)* (x+size) + (y-size)* (y-size) <= size*size*1.2;
        const right = (x-size)*(x-size) + (y-size)*(y-size) <= size*size*1.2;
        const tri = y>=size && Math.abs(x) <= (size*2 - (y-size));
        if (left || right || tri) this._addBlock(X,Y,color,'special');
      }
    }
  }

  _goldenExplosion(area) {
    const cx = Math.floor(CONFIG.cols/2), cy = Math.floor(CONFIG.rows/2);
    for (let dy=-Math.floor(area/2); dy<=Math.floor(area/2); dy++) {
      for (let dx=-Math.floor(area/2); dx<=Math.floor(area/2); dx++) {
        const x=cx+dx, y=cy+dy; if (x<0||y<0||x>=CONFIG.cols||y>=CONFIG.rows) continue;
        this._breakOne(x,y,true);
        this._addBlock(x,y,'#ffd54f','gold');
      }
    }
  }

  _rainbowExplosion(area) {
    const cx = Math.floor(CONFIG.cols/2), cy = Math.floor(CONFIG.rows/2);
    const rainbow = ['#ff5c5c','#f59e0b','#f7dd00','#43e97b','#3b82f6','#7c3aed','#ff77c8'];
    for (let dy=-Math.floor(area/2); dy<=Math.floor(area/2); dy++) {
      for (let dx=-Math.floor(area/2); dx<=Math.floor(area/2); dx++) {
        const x=cx+dx, y=cy+dy; if (x<0||y<0||x>=CONFIG.cols||y>=CONFIG.rows) continue;
        this._breakOne(x,y,true);
        const color = rainbow[(x+y+rainbow.length)%rainbow.length];
        this._addBlock(x,y,color,'rainbow');
      }
    }
  }

  _addMemorialBlock(name) {
    const x = randInt(CONFIG.cols), y = randInt(CONFIG.rows);
    this._addBlock(x,y,'#ffd54f','gold');
    this._announce(`${name} memorial block`, '#ffd54f');
  }

  _incStreak() {
    this.stats.streak++;
    if (this.stats.streak % 10 === 0) this._announce(`Streak ${this.stats.streak}!`, '#11ffee');
  }

  // Command handlers
  _commandHandlers() {
    const mkColorCmd = (color) => (mult=1) => {
      for (let i=0;i<mult;i++) {
        const x=randInt(CONFIG.cols), y=randInt(CONFIG.rows);
        this._addBlock(x,y,color,'normal');
      }
      this.sound.beep(520, 90, 'sine');
    };
    const handlers = {
      // Popular slang commands
      'skibidi': (mult=1) => {
        // dance a random block and break nearby
        for (let i=0;i<mult;i++) {
          const x=randInt(CONFIG.cols), y=randInt(CONFIG.rows);
          const cell = this.grid[y][x]; if (!cell) continue;
          cell.glow = 0.9; cell.color = '#ff77c8';
          [-1,0,1].forEach(dx=>[-1,0,1].forEach(dy=>{ if(dx||dy) this._breakOne(clamp(x+dx,0,CONFIG.cols-1), clamp(y+dy,0,CONFIG.rows-1), true);}));
        }
        this.sound.beep(640, 140, 'triangle');
      },
      'rizz': (mult=1) => {
        const cx=Math.floor(CONFIG.cols/2), cy=Math.floor(CONFIG.rows/2);
        this._heartPattern(cx, cy, 2*mult, '#ff77c8');
        this.sound.beep(480, 120, 'sine');
      },
      'sigma': (mult=1) => {
        const cx=Math.floor(CONFIG.cols/2), cy=Math.floor(CONFIG.rows/2);
        this._crossExplosion(cx, cy, 4*mult);
        this.sound.beep(220, 150, 'square');
      },
      'gyat': (mult=1) => {
        this.stageWrapper.classList.add('shake');
        setTimeout(()=>this.stageWrapper.classList.remove('shake'), 350);
        const cx=Math.floor(CONFIG.cols/2), cy=Math.floor(CONFIG.rows/2);
        this._explosion(cx, cy, 1+mult);
        this.sound.beep(180, 140, 'sawtooth');
      },
      'ohio': (mult=1) => {
        const end = now() + 5000;
        const chaos = () => {
          if (now()>end) return;
          for (let i=0;i<8;i++) {
            const x=randInt(CONFIG.cols), y=randInt(CONFIG.rows);
            (Math.random()<0.5?this._breakOne:this._addBlock.bind(this))(x,y,this.colors[randInt(this.colors.length)],'normal');
          }
          setTimeout(chaos, 120);
        };
        chaos();
        this.sound.beep(260, 200, 'triangle');
      },

      // Action commands
      'break': (mult=1) => {
        const cx=Math.floor(CONFIG.cols/2), cy=Math.floor(CONFIG.rows/2);
        for(let i=0;i<mult;i++) this._breakOne(cx,cy,true);
        this.sound.beep(620, 100, 'triangle');
      },
      'boom': (mult=1) => {
        const cx=Math.floor(CONFIG.cols/2), cy=Math.floor(CONFIG.rows/2);
        this._explosion(cx, cy, 1+mult);
        this.sound.beep(240, 160, 'square');
      },
      'nuke': (mult=1) => {
        const cx=Math.floor(CONFIG.cols/2), cy=Math.floor(CONFIG.rows/2);
        this._explosion(cx, cy, 2+mult);
        this.sound.beep(120, 220, 'sawtooth');
      },
      'build': (mult=1) => {
        for (let i=0;i<4*mult;i++) {
          const x=randInt(CONFIG.cols), y=randInt(CONFIG.rows);
          this._addBlock(x,y,this.colors[randInt(this.colors.length)],'normal');
        }
        this.sound.beep(500, 120, 'sine');
      },
      'tnt': (mult=1) => {
        // plant TNT blocks in small clusters for dramatic chain reactions
        for (let i=0;i<mult;i++) {
          const cx=randInt(CONFIG.cols), cy=randInt(CONFIG.rows);
          for (let dy=-1; dy<=1; dy++) {
            for (let dx=-1; dx<=1; dx++) {
              const x = clamp(cx+dx, 0, CONFIG.cols-1);
              const y = clamp(cy+dy, 0, CONFIG.rows-1);
              this._addBlock(x, y, '#d32f2f', 'tnt');
            }
          }
        }
        this._announce('TNT armed!');
        this.sound.beep(160, 150, 'square');
      },

      // Basic color commands
      'red': mkColorCmd('#ff5c5c'),
      'blue': mkColorCmd('#3b82f6'),
      'green': mkColorCmd('#43e97b'),
      'yellow': mkColorCmd('#f59e0b'),
      'purple': mkColorCmd('#b388ff'),
      'pink': mkColorCmd('#ff77c8'),
      'orange': mkColorCmd('#f59e0b'),
      'white': mkColorCmd('#ffffff'),
      'black': mkColorCmd('#111827'),
      'rainbow': (mult=1) => this._rainbowExplosion(2*mult),

      // Meme numbers
      '69': (mult=1) => {
        this._announce('Nice!');
        const cx=Math.floor(CONFIG.cols/2), cy=Math.floor(CONFIG.rows/2);
        const w=6*mult, h=9*mult;
        for (let y=cy-Math.floor(h/2); y<=cy+Math.floor(h/2); y++) {
          for (let x=cx-Math.floor(w/2); x<=cx+Math.floor(w/2); x++) {
            if (x<0||y<0||x>=CONFIG.cols||y>=CONFIG.rows) continue;
            this._breakOne(x,y,true);
          }
        }
        this.sound.beep(420, 140, 'triangle');
      },
      '420': (mult=1) => {
        const cx=Math.floor(CONFIG.cols/2), cy=Math.floor(CONFIG.rows/2);
        const green='#43e97b';
        this._circleBreak(cx,cy,3*mult);
        for (let i=0;i<12*mult;i++) {
          const x=randInt(CONFIG.cols), y=randInt(CONFIG.rows);
          this._addBlock(x,y,green,'normal');
        }
        this.sound.beep(320, 160, 'sine');
      },
      '100': (mult=1) => {
        const cx=Math.floor(CONFIG.cols/2), cy=Math.floor(CONFIG.rows/2);
        this._circleBreak(cx, cy, 4*mult);
        this.sound.beep(500, 100, 'triangle');
      },

      // Emoji
      '❤️': (mult=1) => {
        const cx=Math.floor(CONFIG.cols/2), cy=Math.floor(CONFIG.rows/2);
        this._heartPattern(cx, cy, 2*mult, '#ff77c8');
        this.sound.beep(520, 120, 'sine');
      },
      '⭐': (mult=1) => {
        for(let i=0;i<10*mult;i++) {
          const x=randInt(CONFIG.cols), y=randInt(CONFIG.rows);
          this._addBlock(x,y,'#ffd54f','star');
        }
        this.sound.beep(660, 120, 'triangle');
      },
      '🎉': (mult=1) => {
        for(let i=0;i<30*mult;i++) {
          this._spawnParticles(randInt(CONFIG.cols), randInt(CONFIG.rows), 12, ['#ff5c5c','#f59e0b','#43e97b','#3b82f6','#ff77c8'][randInt(5)]);
        }
        this._announce('Party!', '#ffd54f');
        this.sound.beep(700, 140, 'sine');
      },
    };
    return handlers;
  }

  _fallbackHandler(cmd) {
    return (mult=1) => {
      // Default: random effect
      const actions = ['boom','build','break','rainbow'];
      const h = this._commandHandlers()[actions[randInt(actions.length)]];
      h(mult);
    };
  }

  _startLoop() {
    let last = now();
    const loop = () => {
      const t = now();
      const dt = t - last; last = t;
      // process a few actions per frame to simulate queue handling
      const maxPerFrame = 6;
      for (let i=0;i<maxPerFrame && this.actions.length;i++) {
        const fn = this.actions.shift(); try { fn(); } catch (e) { console.error(e); }
      }
      this._drawGrid();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}

// Bootstrap
const canvas = document.getElementById('gameCanvas');
const game = new Game(canvas);
// Initialize livestream monitor after game construction so the method exists
game._initLiveMonitor?.();
// Initialize YouTube monitor (likes, memberships) if API key is provided
game._initYouTubeMonitor?.();

// Initial HUD update
game._updateHud();

// Drag-and-drop for HUD and controls islands
function initDraggables() {
  const els = document.querySelectorAll('.draggable');
  els.forEach(makeDraggable);
}

function makeDraggable(el) {
  const id = el.id || null;
  // Restore saved position if present
  if (id) {
    const saved = localStorage.getItem('drag:' + id);
    if (saved) {
      try {
        const pos = JSON.parse(saved);
        el.style.position = 'absolute';
        el.style.left = pos.left + 'px';
        el.style.top = pos.top + 'px';
        el.style.right = 'auto';
        el.style.transform = 'none';
      } catch {}
    }
  }

  let dragging = false;
  let offX = 0, offY = 0;

  const start = (clientX, clientY) => {
    // Start drag and normalize positioning
    dragging = true;
    const rect = el.getBoundingClientRect();
    offX = clientX - rect.left;
    offY = clientY - rect.top;
    const computed = window.getComputedStyle(el);
    if (computed.position !== 'absolute') {
      el.style.position = 'absolute';
      el.style.left = rect.left + 'px';
      el.style.top = rect.top + 'px';
    }
    el.style.right = 'auto';
    el.style.transform = 'none';
    document.body.style.userSelect = 'none';
  };

  const move = (clientX, clientY) => {
    if (!dragging) return;
    const left = clamp(clientX - offX, 0, window.innerWidth - el.offsetWidth);
    const top = clamp(clientY - offY, 0, window.innerHeight - el.offsetHeight);
    el.style.left = left + 'px';
    el.style.top = top + 'px';
  };

  const end = () => {
    if (!dragging) return;
    dragging = false;
    document.body.style.userSelect = '';
    if (id) {
      const left = parseFloat(el.style.left) || 0;
      const top = parseFloat(el.style.top) || 0;
      localStorage.setItem('drag:' + id, JSON.stringify({ left, top }));
    }
  };

  el.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    // Don't start drag when interacting with form controls inside
    if (e.target.closest('button, input, label, a, textarea, select')) return;
    start(e.clientX, e.clientY);
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
  window.addEventListener('mouseup', end);

  el.addEventListener('touchstart', (e) => {
    const t = e.touches && e.touches[0];
    if (!t) return;
    if (e.target.closest('button, input, label, a, textarea, select')) return;
    start(t.clientX, t.clientY);
  }, { passive: true });
  window.addEventListener('touchmove', (e) => {
    const t = e.touches && e.touches[0];
    if (!t) return;
    move(t.clientX, t.clientY);
  }, { passive: true });
  window.addEventListener('touchend', end);
}

initDraggables();

// --- Physics augmentation: falling objects with sprite, rotation, and bounces ---
class Body {
  constructor({ x, y, r, color = '#fff', type = 'orb', vx = 0, vy = 0, spriteIndex = null, sheet = 'item', likes = null, labelText = null, bounceTarget = 0, maxLifetimeSec = null }) {
    this.x = x; this.y = y; this.r = r; this.color = color; this.type = type;
    this.vx = vx; this.vy = vy; this.alive = true; this.impactDone = false;
    this.angle = Math.random() * Math.PI * 2;
    this.angVel = (Math.random() - 0.5) * 3; // rad/s
    this.restitution = 0.5; // bounce energy
    this.spriteIndex = spriteIndex;
    this.sheet = sheet; // 'item' (icons.png) or 'tnt' (tnt.png)
    this.likes = likes;
    this.labelText = labelText;
    this.bounceCount = 0;
    this.bounceTarget = bounceTarget;
    this.createdAt = performance.now();
    this.maxLifetimeSec = maxLifetimeSec;
  }
}

(function augmentGamePhysics(){
  const origDrawGrid = Game.prototype._drawGrid;

  Game.prototype._ensurePhysics = function() {
    if (this._physicsInit) return;
    this.bodies = this.bodies || [];
    this.gravity = this.gravity || 900;
    this.scrollOffset = this.scrollOffset || 0; // pixels scrolled (negative for upward)
    this.scrollSpeed = this.scrollSpeed || 60; // pixels per second
    this._lastPhysT = performance.now();
    this._physicsInit = true;
    // init textures lazily
    this._initTextures?.() || (this._initTextures = () => {
      this.textureAtlasLoaded = false;
      const img = new Image();
      img.src = 'textures.png'; // blocks atlas
      img.onload = () => { this.textureAtlasLoaded = true; this.textureAtlas = img; this._buildTextureSlices(); };
      img.onerror = () => { this.textureAtlasLoaded = false; };
      this.textureAtlas = img;
    });
    this._initTextures();

    // load item sprite sheet for falling bodies (uses root textures.png)
    this._initItemAtlas?.() || (this._initItemAtlas = () => {
      this.itemAtlasLoaded = false;
      const itemImg = new Image();
      itemImg.src = 'icons.png'; // falling items atlas
      itemImg.onload = () => { this.itemAtlasLoaded = true; this.itemAtlas = itemImg; this._buildItemSlices(); };
      itemImg.onerror = () => { this.itemAtlasLoaded = false; };
      this.itemAtlas = itemImg;
    });
    this._initItemAtlas();

    // load TNT sprite sheet for falling TNT bodies
    this._initTntAtlas?.() || (this._initTntAtlas = () => {
      this.tntAtlasLoaded = false;
      const tntImg = new Image();
      const tryLoad = (src, onfail) => {
        const img = new Image();
        img.src = src;
        img.onload = () => { this.tntAtlasLoaded = true; this.tntAtlas = img; this._buildTntSlices(); };
        img.onerror = () => { onfail && onfail(); };
      };
      // try png first, then jpg
      tryLoad('tnt.png', () => tryLoad('tnt.jpg', () => { this.tntAtlasLoaded = false; }));
    });
  this._initTntAtlas();
  };

  // Sequentially iterate TNT sprite indices so each drop uses the next sprite
  Game.prototype._nextTntSpriteIndex = function() {
    if (!this.tntSlices?.length) return 0;
    if (this._tntSpriteCursor == null) this._tntSpriteCursor = 0;
    const idx = this._tntSpriteCursor;
    this._tntSpriteCursor = (this._tntSpriteCursor + 1) % this.tntSlices.length;
    return idx;
  };

  // Simple livestream monitor: listens for postMessage events from OBS/Bots
  Game.prototype._initLiveMonitor = function() {
    try {
      window.addEventListener('message', (e) => {
        const msg = e?.data;
        if (!msg || typeof msg !== 'object') return;
        const t = String(msg.type || '').toLowerCase();
        if (t === 'like') {
          this.onLike();
        } else if (t === 'sub' || t === 'subscribe' || t === 'subscriber') {
          this.onSub(msg.name || 'Anonymous');
        } else if (t === 'member' || t === 'membership' || t === 'join') {
          this.onMember(msg.name || 'Anonymous');
        }
      });
    } catch (err) {
      console.warn('Live monitor init failed:', err);
    }
  };

  // YouTube monitor: polls likes and memberships via YouTube Data API v3
  Game.prototype._initYouTubeMonitor = function() {
    const apiKey = getYouTubeApiKey();
    // Default to configured videoId if present, else use provided stream URL id
    const videoId = (CONFIG.youtubeVideoId || 'XgFtKEmCCl4');
    if (!apiKey || !videoId) {
      console.warn('YouTube monitor disabled: missing API key or videoId');
      return;
    }

    let likeCount = null;
    let liveChatId = null;
    let chatPageToken = null;
    const pollMs = CONFIG.youtubePollMs || 8000;

    const fetchJson = async (url) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    };

    const fetchLiveDetails = async () => {
      const url = `https://www.googleapis.com/youtube/v3/videos?part=liveStreamingDetails,statistics&id=${videoId}&key=${apiKey}`;
      const json = await fetchJson(url);
      const item = json.items && json.items[0];
      if (!item) return;
      const stats = item.statistics || {};
      const details = item.liveStreamingDetails || {};
      likeCount = Number(stats.likeCount || 0);
      liveChatId = details.activeLiveChatId || null;
    };

    const pollLikes = async () => {
      try {
        const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${videoId}&key=${apiKey}`;
        const json = await fetchJson(url);
        const item = json.items && json.items[0];
        if (!item) return;
        const current = Number((item.statistics || {}).likeCount || 0);
        if (likeCount == null) {
          likeCount = current;
        } else if (current > likeCount) {
          const delta = current - likeCount;
          likeCount = current;
          for (let i = 0; i < delta; i++) this.onLike();
        }
      } catch (err) {
        // Silently ignore transient errors
      }
    };

    const pollChat = async () => {
      if (!liveChatId) return;
      try {
        const url = `https://www.googleapis.com/youtube/v3/liveChat/messages?liveChatId=${liveChatId}&part=snippet,authorDetails&key=${apiKey}` + (chatPageToken ? `&pageToken=${chatPageToken}` : '');
        const json = await fetchJson(url);
        chatPageToken = json.nextPageToken || null;
        const items = json.items || [];
        for (const m of items) {
          const type = (m.snippet && m.snippet.type) || '';
          const name = (m.authorDetails && m.authorDetails.displayName) || 'Anonymous';
          // Membership events
          if (type === 'newSponsor' || type === 'membershipItem' || type === 'giftMembershipReceivedEvent') {
            this.onMember(name);
          }
        }
      } catch (err) {
        // Ignore errors to avoid spamming console
      }
    };

    // Prime state and start polling
    fetchLiveDetails().then(() => {
      pollLikes();
      if (liveChatId) pollChat();
    }).catch(() => {});
    setInterval(pollLikes, pollMs);
    setInterval(pollChat, pollMs);
  };

  Game.prototype._drawBodies = function() {
    const ctx = this.ctx;
    for (const b of this.bodies) {
      if (!b.alive) continue;
      const drawSize = b.r * 2;
      if (b.type === 'cluster') {
        const { size } = this._cellSize();
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.angle);
        for (const cell of b.cells) {
          const dx = cell.dx * size - size/2;
          const dy = cell.dy * size - size/2;
          if (this.textureAtlasLoaded && this.textureSlices?.length) {
    if (cell.textureIndex == null) cell.textureIndex = randInt(this.textureSlices.length);
            const s = this.textureSlices[cell.textureIndex % this.textureSlices.length];
            if (s) ctx.drawImage(this.textureAtlas, s.sx, s.sy, s.sw, s.sh, dx, dy, size, size);
          } else {
            ctx.fillStyle = cell.color;
            ctx.fillRect(dx, dy, size, size);
          }
          // Keep TNT cross visible on detached TNT blocks
          if (cell.type === 'tnt') {
            ctx.strokeStyle = '#111';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(dx+3, dy+3); ctx.lineTo(dx+size-3, dy+size-3);
            ctx.moveTo(dx+size-3, dy+3); ctx.lineTo(dx+3, dy+size-3);
            ctx.stroke();
          }
        }
        ctx.restore();
        continue;
      }
      if (b.sheet === 'tnt' && this.tntAtlasLoaded && this.tntSlices?.length) {
        const idx = (b.spriteIndex ?? 0) % this.tntSlices.length;
        const s = this.tntSlices[idx];
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.angle);
        ctx.drawImage(this.tntAtlas, s.sx, s.sy, s.sw, s.sh, -drawSize/2, -drawSize/2, drawSize, drawSize);
        ctx.restore();
        // overlay likes and message
        if (b.likes != null || b.labelText) {
          ctx.save();
          ctx.font = '12px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillStyle = '#fff';
          const msg = [b.likes != null ? `+${b.likes}` : null, b.labelText].filter(Boolean).join(' ');
          ctx.fillText(msg, b.x, b.y - drawSize*0.7);
          ctx.restore();
        }
      } else if (this.itemAtlasLoaded && this.itemSlices?.length) {
        const idx = (b.spriteIndex ?? 0) % this.itemSlices.length;
        const s = this.itemSlices[idx];
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.angle);
        ctx.drawImage(this.itemAtlas, s.sx, s.sy, s.sw, s.sh, -drawSize/2, -drawSize/2, drawSize, drawSize);
        ctx.restore();
      } else {
        // fallback gradient orb
        const g = ctx.createRadialGradient(b.x, b.y, b.r*0.2, b.x, b.y, b.r);
        g.addColorStop(0, 'rgba(255,255,255,0.9)');
        g.addColorStop(1, b.color);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI*2); ctx.fill();
      }
    }
  };

  Game.prototype._spawnBody = function({ type = 'orb', col = randInt(CONFIG.cols), color = '#fff', radiusFactor = 0.4, vx = 0, vy = 0, sheet = 'item', likes = null, labelText = null, spriteIndex = null, bounceTarget = null, maxLifetimeSec = null, x: xOverride = null, y: yOverride = null }) {
    const { size, offX, offY } = this._cellSize();
    let r = Math.max(6, size * radiusFactor);
    // Randomly make some items bigger
    const makeBig = Math.random() < 0.25; // 25% chance
    if (makeBig) r *= 1.35;
    const x = (xOverride != null) ? xOverride : (offX + clamp(col, 0, CONFIG.cols-1) * size + size/2);
    const y = (yOverride != null) ? yOverride : (offY - r - 4);
    const paletteColor = color || this.colors[randInt(this.colors.length)];
    // pick sprite index based on sheet
    let idx = spriteIndex;
    if (idx == null) {
      if (sheet === 'tnt' && this.tntSlices?.length) idx = this._nextTntSpriteIndex();
      else if (this.itemSlices?.length) idx = randInt(this.itemSlices.length);
      else idx = null;
    }
    // TNT should bounce 2-5 times before exploding
    let bt = bounceTarget;
    if (bt == null && type === 'tnt_fall') bt = 2 + randInt(4); // 2..5
    // TNT lifetime cap
    const ttl = maxLifetimeSec != null ? maxLifetimeSec : (type === 'tnt_fall' ? 10 : null);
    this.bodies.push(new Body({ x, y, r, color: paletteColor, type, vx, vy, spriteIndex: idx, sheet, likes, labelText, bounceTarget: bt, maxLifetimeSec: ttl }));
  };

  Game.prototype._updateBodies = function(dt) {
    this._ensurePhysics();
    const g = this.gravity;
    const { size, offX, offY } = this._cellSize();
    const gridW = size*CONFIG.cols, gridH = size*CONFIG.rows;
    const left = offX, right = offX + gridW, top = offY + this.scrollOffset, bottom = offY + this.scrollOffset + gridH;
    for (const b of this.bodies) {
      if (!b.alive) continue;
      // TNT max lifetime: explode after 10 seconds even if not enough bounces
      if ((b.type === 'tnt_fall' || b.type === 'tnt_nuke') && b.maxLifetimeSec != null) {
        const age = (performance.now() - (b.createdAt || performance.now()))/1000;
        if (age >= b.maxLifetimeSec) {
          const col = clamp(Math.floor((b.x - offX) / size), 0, CONFIG.cols-1);
          const row = clamp(Math.floor((b.y - (offY + this.scrollOffset)) / size), 0, CONFIG.rows-1);
          if (b.type === 'tnt_nuke') this._tntNuke(col, row); else this._tntFinale(col, row, b.spriteIndex);
          b.alive = false;
          continue;
        }
      }
      // add wind for more horizontal movement
      const wind = Math.sin(performance.now()/300 + b.x*0.01) * 70; // px/s^2 lateral
      const airDrag = 0.98;
      b.vx += wind * dt * 0.4;
      b.vy += g * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      b.vx *= airDrag;
      b.angle += b.angVel * dt;
      if (b.x - b.r < left) { b.x = left + b.r; b.vx = Math.abs(b.vx) * 0.6; b.angVel *= -0.7; }
      if (b.x + b.r > right) { b.x = right - b.r; b.vx = -Math.abs(b.vx) * 0.6; b.angVel *= -0.7; }
      if (b.y + b.r >= top && b.y - b.r <= bottom) {
        // improved circle-rect collision against nearby cells
        const startCol = clamp(Math.floor((b.x - offX - b.r) / size), 0, CONFIG.cols-1);
        const endCol   = clamp(Math.floor((b.x - offX + b.r) / size), 0, CONFIG.cols-1);
        const startRow = clamp(Math.floor((b.y - (offY + this.scrollOffset) - b.r) / size), 0, CONFIG.rows-1);
        const endRow   = clamp(Math.floor((b.y - (offY + this.scrollOffset) + b.r) / size), 0, CONFIG.rows-1);
        let collided = false;
        for (let row=startRow; row<=endRow && !collided; row++) {
          for (let col=startCol; col<=endCol && !collided; col++) {
            const cell = this.grid[row][col];
            if (!cell?.alive) continue;
            const rx = offX + col*size, ry = (offY + this.scrollOffset) + row*size;
            if (!this._circleRectOverlap(b.x, b.y, b.r, rx, ry, size, size)) continue;
            // TNT block: explode, but TNT bodies keep bouncing until their bounceTarget
            if (cell.type === 'tnt') {
              this._explosion(col, row, 2);
              this.sound.beep(140, 220, 'square');
              // For TNT falling bodies, do not consume immediately; count bounce
              if (b.type === 'tnt_fall' || b.type === 'tnt_nuke') {
                b.bounceCount++;
                // Variant-based item drops on bounce
                const variant = (b.spriteIndex ?? 0) % 8;
                if (variant === 5) {
                  const dropCount = 10;
                  for (let i=0;i<dropCount;i++) {
                    this._spawnBody({ type: 'orb', sheet: 'item', color: this.colors[randInt(this.colors.length)], radiusFactor: 0.35, vx: (Math.random()-0.5)*160, vy: -100, x: b.x, y: b.y });
                  }
                }
                // Acid bomb: corrode 3x3 on every bounce and queue timed spread
                if (variant === 6) {
                  this._corrode2x2(col, row, true);
                  this._queueAcidEffect(col, row, 6);
                }
              } else {
                b.alive = false;
                collided = true;
                break;
              }
            }
            // Red blocks: trigger explosions; clusters explode relative to their size
            if (this._isRed?.(cell.color)) {
              if (b.type === 'tnt_fall' || b.type === 'tnt_nuke') {
                b.bounceCount++;
                const variant = (b.spriteIndex ?? 0) % 8;
                if (variant === 5) {
                  const dropCount = 10;
                  for (let i=0;i<dropCount;i++) {
                    this._spawnBody({ type: 'orb', sheet: 'item', color: this.colors[randInt(this.colors.length)], radiusFactor: 0.35, vx: (Math.random()-0.5)*160, vy: -100, x: b.x, y: b.y });
                  }
                }
                if (variant === 6) {
                  this._corrode2x2(col, row, true);
                  this._queueAcidEffect(col, row, 6);
                }
              } else if (b.type === 'cluster') {
                // Determine explosion radius based on cluster size (number of cells)
                const n = Array.isArray(b.cells) ? b.cells.length : 1;
                const radius = clamp(Math.ceil(Math.sqrt(n) * 0.5), 1, 7);
                this._explosion(col, row, radius);
                this.sound.beep(180, 200 + radius*20, 'square');
                b.alive = false;
                collided = true;
                break;
              } else {
                // Non-cluster items: small pop
                this._explosion(col, row, 1);
                this.sound.beep(200, 160, 'square');
                b.alive = false;
                collided = true;
                break;
              }
            }
            this._breakOne(col, row, true);
            // stronger bounce and sideways kick
            b.restitution = 0.85;
            b.vy = -Math.abs(b.vy) * b.restitution;
            const sideKick = (Math.random() < 0.5 ? -1 : 1) * (Math.abs(b.vy) * 0.45 + randInt(80));
            b.vx = b.vx * 1.1 + sideKick;
            b.y = (offY + this.scrollOffset) + row*size - b.r;
            b.angVel += (Math.random()-0.5) * 3.5; // more spin on impact
            if (!b.impactDone) {
              // TNT falling bodies: apply finale after enough bounces
              if (b.type === 'tnt_fall' || b.type === 'tnt_nuke') {
                if (b.bounceCount >= b.bounceTarget) {
                  if (b.type === 'tnt_nuke') this._tntNuke(col, row); else this._tntFinale(col, row, b.spriteIndex);
                  b.alive = false;
                }
              }
              if (b.type === 'gold_bomb') { this._goldenExplosion(5); }
              if (b.type === 'rainbow_bomb') { this._rainbowExplosion(7); }
              b.impactDone = true;
            }
            collided = true;
          }
        }
      }
      if (b.y - b.r > bottom + 100) b.alive = false;
    }
    this.bodies = this.bodies.filter(b => b.alive);
  };

  // Wrap drawGrid to include endless scrolling, physics, and body rendering
  Game.prototype._drawGrid = function() {
    this._ensurePhysics();
    const t = performance.now();
    const dt = ((t - (this._lastPhysT || t)))/1000; this._lastPhysT = t;
    this._updateScroll?.(dt);
    this._updateBodies(dt);
    // Timed acid effect updates (spread or self-destroy)
    this._updateAcid?.(dt);

    const { size, offX, offY } = this._cellSize();
    const ctx = this.ctx;
    ctx.clearRect(0,0,this.width,this.height);
    // simple screen shake for spectacle
    ctx.save();
    // Centered render scaling so blocks appear larger without changing grid dimensions
    const s = (CONFIG.renderScale || 1);
    if (s !== 1) {
      ctx.translate(this.width/2, this.height/2);
      ctx.scale(s, s);
      ctx.translate(-this.width/2, -this.height/2);
    }
    if (!this.shake) this.shake = 0;
    if (this.shake > 0) {
      const amp = 6;
      const sx = (Math.random()-0.5) * amp * this.shake;
      const sy = (Math.random()-0.5) * amp * this.shake;
      ctx.translate(sx, sy);
      this.shake = Math.max(0, this.shake - 0.03);
    }
    const topY = offY + this.scrollOffset;

    for (let y=0;y<CONFIG.rows;y++) {
      for (let x=0;x<CONFIG.cols;x++) {
        const c = this.grid[y][x];
        const px = offX + x*size;
        const py = topY + y*size;
        if (!c.alive) {
          ctx.fillStyle = 'rgba(255,255,255,0.05)';
          ctx.fillRect(px, py, size, size);
          continue;
        }
        ctx.fillStyle = c.color;
        ctx.fillRect(px, py, size, size);
        if (c.type === 'tnt') {
          ctx.strokeStyle = '#111';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(px+3, py+3); ctx.lineTo(px+size-3, py+size-3);
          ctx.moveTo(px+size-3, py+3); ctx.lineTo(px+3, py+size-3);
          ctx.stroke();
        }
        if (c.glow > 0) {
          ctx.strokeStyle = `rgba(255,255,255,${c.glow})`;
          ctx.lineWidth = 2;
          ctx.strokeRect(px+1, py+1, size-2, size-2);
          c.glow = Math.max(0, c.glow - 0.02);
        }
      }
    }

    // particles (render in scrolled space)
    this.particles.forEach(p => {
      p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.life -= 1;
      ctx.globalAlpha = Math.max(0, p.life / p.lifeMax);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x, p.y + this.scrollOffset, p.size, p.size);
      ctx.globalAlpha = 1;
    });
    this.particles = this.particles.filter(p => p.life > 0);

    // overlay textures on blocks (if atlas present)
    this._drawTextures?.() || (this._drawTextures = () => {
      if (!this.textureAtlasLoaded) return;
      const { size, offX, offY } = this._cellSize();
      const slices = this.textureSlices || [];
      const ctx = this.ctx;
      const topY = offY + this.scrollOffset;
      for (let y=0;y<CONFIG.rows;y++) {
        for (let x=0;x<CONFIG.cols;x++) {
          const c = this.grid[y][x];
          if (!c?.alive) continue;
          if (c.textureIndex == null) {
            // Assign texture based on block type using classified atlas slices
            const cls = this.textureClasses || { soil: [], stone: [], ore: [] };
            let candidates = null;
            if (c.type === 'soil') candidates = cls.soil;
            else if (c.type === 'stone') candidates = cls.stone;
            else if (c.type === 'ore') candidates = cls.ore;
            if (candidates && candidates.length) {
              c.textureIndex = candidates[randInt(candidates.length)];
            } else {
              // No class candidates: pick nearest texture by the block's color
              const nearest = this._nearestTextureIndexForColor(c.color);
              c.textureIndex = (nearest != null) ? nearest : randInt(slices.length);
            }
          }
          const s = slices[c.textureIndex]; if (!s) continue;
          ctx.drawImage(this.textureAtlas, s.sx, s.sy, s.sw, s.sh, offX + x*size, topY + y*size, size, size);
          // ensure TNT cross remains visible on top of texture
          if (c.type === 'tnt') {
            ctx.strokeStyle = '#111';
            ctx.lineWidth = 2;
            ctx.beginPath();
            const px = offX + x*size, py = topY + y*size;
            ctx.moveTo(px+3, py+3); ctx.lineTo(px+size-3, py+size-3);
            ctx.moveTo(px+size-3, py+3); ctx.lineTo(px+3, py+size-3);
            ctx.stroke();
          }
        }
      }
    });
    this._drawTextures();
    this._drawBodies();
    ctx.restore();
  };

  // Endless scrolling helpers
  Game.prototype._shiftGridUp = function() {
    // remove top row and add a fresh row at the bottom
    this.grid.shift();
    // New rows represent deeper ground: stone/ore mix, rare colorful blocks
    const newRow = this._generateTerrainRow(CONFIG.rows - 1);
    this.grid.push(newRow);
  };

  // Detect floating clusters (not connected to bottom support) and detach them as falling bodies
  Game.prototype._detachFloatingClusters = function() {
    const rows = CONFIG.rows, cols = CONFIG.cols;
    const alive = (y,x) => this.grid[y]?.[x]?.alive;
    const supported = Array.from({length: rows}, () => Array(cols).fill(false));
    // BFS from bottom row alive cells to mark supported
    const q = [];
    for (let x=0;x<cols;x++) { if (alive(rows-1,x)) { supported[rows-1][x] = true; q.push([rows-1,x]); } }
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
    while (q.length) {
      const [y,x] = q.shift();
      for (const [dy,dx] of dirs) {
        const ny=y+dy, nx=x+dx; if (ny<0||nx<0||ny>=rows||nx>=cols) continue;
        if (!alive(ny,nx) || supported[ny][nx]) continue;
        supported[ny][nx] = true; q.push([ny,nx]);
      }
    }
    // Find unsupported clusters
    const seen = Array.from({length: rows}, () => Array(cols).fill(false));
    const clusters = [];
    for (let y=0;y<rows;y++) for (let x=0;x<cols;x++) {
      if (!alive(y,x) || supported[y][x] || seen[y][x]) continue;
      const comp = [];
      const qq = [[y,x]]; seen[y][x] = true;
      let minY=y,maxY=y,minX=x,maxX=x;
      while (qq.length) {
        const [cy,cx] = qq.shift();
        const gc = this.grid[cy][cx];
        comp.push({ y: cy, x: cx, color: gc.color, type: gc.type, textureIndex: gc.textureIndex });
        minY=Math.min(minY,cy);maxY=Math.max(maxY,cy);minX=Math.min(minX,cx);maxX=Math.max(maxX,cx);
        for (const [dy,dx] of dirs) {
          const ny=cy+dy,nx=cx+dx; if (ny<0||nx<0||ny>=rows||nx>=cols) continue;
          if (seen[ny][nx] || !alive(ny,nx) || supported[ny][nx]) continue;
          seen[ny][nx]=true; qq.push([ny,nx]);
        }
      }
      clusters.push({ cells: comp, bounds: { minY, maxY, minX, maxX } });
    }
    // Detach clusters by removing from grid and spawning falling cluster bodies
    if (!clusters.length) return;
    const { size, offX, offY } = this._cellSize();
    for (const cl of clusters) {
      const centerCol = Math.floor((cl.bounds.minX + cl.bounds.maxX) / 2);
      const centerRow = Math.floor((cl.bounds.minY + cl.bounds.maxY) / 2);
      // Remove from grid
      for (const cell of cl.cells) { this.grid[cell.y][cell.x].alive = false; }
      // Build relative cells
      const relCells = cl.cells.map(cell => ({ dx: cell.x - centerCol, dy: cell.y - centerRow, color: cell.color, type: cell.type, textureIndex: cell.textureIndex }));
      const x = offX + (centerCol + 0.5) * size;
      const y = offY + this.scrollOffset + (centerRow + 0.5) * size;
      const radiusFactor = Math.max(0.6, Math.sqrt((cl.bounds.maxX - cl.bounds.minX + 1)**2 + (cl.bounds.maxY - cl.bounds.minY + 1)**2) * 0.5 / (CONFIG.rows));
      const r = Math.max(10, radiusFactor * size);
      const vx = (Math.random()-0.5) * 60;
      const vy = 0;
      const b = new Body({ x, y, r, color: '#fff', type: 'cluster', vx, vy, spriteIndex: null, sheet: 'item' });
      b.cells = relCells;
      b.restitution = 0.7;
      this.bodies.push(b);
    }
  };

  Game.prototype._updateScroll = function(dt) {
    const { size } = this._cellSize();
    // Only scroll when the top 5 rows have <20% alive blocks
    const aliveRatio = this._topFillRatio ? this._topFillRatio(5) : (function(self){
      let alive=0, total=Math.min(5, CONFIG.rows)*CONFIG.cols;
      for(let y=0;y<Math.min(5, CONFIG.rows);y++) for(let x=0;x<CONFIG.cols;x++) { if (self.grid[y][x]?.alive) alive++; }
      return alive/total;
    })(this);
    // If more than 70% of all blocks are destroyed, double scroll speed
    const destroyedRatio = this._destroyedRatio ? this._destroyedRatio() : (function(self){
      let alive=0, total=CONFIG.rows*CONFIG.cols;
      for(let y=0;y<CONFIG.rows;y++) for(let x=0;x<CONFIG.cols;x++) { if (self.grid[y][x]?.alive) alive++; }
      return total ? (1 - alive/total) : 0;
    })(this);
    let speedMult = 1;
    if (destroyedRatio >= 0.9) speedMult = 10; // turbo scroll when 90% broken
    else if (destroyedRatio > 0.7) speedMult = 3; // fast scroll when 70% broken
    if (aliveRatio < 0.2) {
      this.scrollOffset -= (this.scrollSpeed * speedMult) * dt; // move grid upward
      while (this.scrollOffset <= -size) {
        this.scrollOffset += size;
        this._shiftGridUp();
      }
    }
  };

  Game.prototype._topFillRatio = function(layers=5) {
    const rows = Math.min(layers, CONFIG.rows);
    let alive = 0; const total = rows * CONFIG.cols;
    for (let y=0;y<rows;y++) {
      for (let x=0;x<CONFIG.cols;x++) {
        if (this.grid[y][x]?.alive) alive++;
      }
    }
    return total ? alive / total : 0;
  };

  // Fraction of destroyed blocks across the whole grid (0..1)
  Game.prototype._destroyedRatio = function() {
    let alive = 0; const total = CONFIG.rows * CONFIG.cols;
    for (let y=0;y<CONFIG.rows;y++) {
      for (let x=0;x<CONFIG.cols;x++) {
        if (this.grid[y][x]?.alive) alive++;
      }
    }
    return total ? (1 - alive/total) : 0;
  };

  // Helper: detect red-like colors
  Game.prototype._isRed = function(color) {
    if (!color) return false;
    const hex = color.toLowerCase();
    const known = ['#ff5c5c','#d32f2f','#f44336','#ff0000'];
    if (known.includes(hex)) return true;
    const m = /^#([0-9a-f]{6})$/.exec(hex);
    if (!m) return false;
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    return r > 180 && g < 110 && b < 110;
  };

  // Accurate circle-rectangle overlap for collision detection
  Game.prototype._circleRectOverlap = function(cx, cy, cr, rx, ry, rw, rh) {
    const closestX = clamp(cx, rx, rx+rw);
    const closestY = clamp(cy, ry, ry+rh);
    const dx = cx - closestX;
    const dy = cy - closestY;
    return dx*dx + dy*dy <= cr*cr;
  };

  // Override triggers to use falling bodies
  Game.prototype.onLike = function() {
    this.stats.likes++;
    this._showLikePopup('+1');
    this._spawnBody({ type: 'orb', col: randInt(CONFIG.cols), color: this.colors[randInt(this.colors.length)], radiusFactor: 0.35, vx: (Math.random()-0.5)*160, vy: 0 });
    // Trigger TNT fall at randomized like thresholds (every 5–20 likes)
    if (this._nextTntAt != null && this.stats.likes >= this._nextTntAt) {
      const drops = 1 + randInt(3); // 1-3 TNT bodies per trigger
      for (let i=0; i<drops; i++) {
        const likes = 1 + randInt(500);
        this._spawnBody({ type: 'tnt_fall', sheet: 'tnt', col: randInt(CONFIG.cols), color: '#ff4444', radiusFactor: 0.7, vx: (Math.random()-0.5)*120, vy: 0, likes });
      }
      // schedule next trigger in 5–20 more likes
      this._nextTntAt = this.stats.likes + (5 + randInt(16));
      this.sound.beep(180, 180, 'square');
    }
    this._updateHud();
    this.sound.beep(600, 100, 'triangle');
    this._incStreak();
  };

  Game.prototype.onSub = function(name) {
    this.stats.subs++;
    this._updateHud();
    this._announce(`${name} subscribed!`);
    // Drop TNT on new subscriber (no label)
    this._spawnBody({ type: 'tnt_fall', sheet: 'tnt', col: randInt(CONFIG.cols), radiusFactor: 0.7, vx: (Math.random()-0.5)*120, vy: 0 });
    this._addMemorialBlock(name);
    this.sound.beep(300, 250, 'square');
    this._pushRecentSub(name);
    this._incStreak();
  };

  Game.prototype.onMember = function(name) {
    this.stats.members++;
    this._updateHud();
    this._announce(`${name} became a Member!`);
    // Drop TNT on new member (no label)
    this._spawnBody({ type: 'tnt_fall', sheet: 'tnt', col: randInt(CONFIG.cols), radiusFactor: 0.7, vx: (Math.random()-0.5)*130, vy: 0 });
    this.sound.beep(200, 350, 'sawtooth');
    this._incStreak();
  };

  Game.prototype.dropNuke = function() {
    this._announce('NUKE deployed!');
    // Spawn the most powerful TNT variant: larger, fast, minimal bounces
    this._spawnBody({ type: 'tnt_nuke', sheet: 'tnt', col: randInt(CONFIG.cols), color: '#ff4444', radiusFactor: 1.0, vx: (Math.random()-0.5)*140, vy: 0, bounceTarget: 1, maxLifetimeSec: 8 });
    this.sound.beep(100, 280, 'square');
  };

  // Replace selected command handlers to use bodies
  const origHandlers = Game.prototype._commandHandlers;
  Game.prototype._commandHandlers = function() {
    const h = origHandlers.call(this);
    h['break'] = (mult=1) => {
      const centerCol=Math.floor(CONFIG.cols/2);
      for(let i=0;i<mult;i++) this._spawnBody({ type: 'orb', col: centerCol, color: '#ffffff', radiusFactor: 0.4, vx: (Math.random()-0.5)*120 });
      this.sound.beep(620, 100, 'triangle');
    };
    h['boom'] = (mult=1) => {
      for(let i=0;i<mult;i++) this._spawnBody({ type: 'gold_bomb', col: randInt(CONFIG.cols), color: '#f59e0b', radiusFactor: 0.5, vx: (Math.random()-0.5)*140 });
      this.sound.beep(240, 160, 'square');
    };
    h['nuke'] = (mult=1) => {
      for(let i=0;i<mult;i++) this._spawnBody({ type: 'gold_bomb', col: randInt(CONFIG.cols), color: '#ffd54f', radiusFactor: 0.9, vx: (Math.random()-0.5)*100 });
      this.sound.beep(120, 220, 'sawtooth');
    };
    h['rainbow'] = (mult=1) => {
      for(let i=0;i<mult;i++) this._spawnBody({ type: 'rainbow_bomb', col: randInt(CONFIG.cols), color: '#ff77c8', radiusFactor: 0.6, vx: (Math.random()-0.5)*120 });
    };
    // Falling TNT using tnt.png atlas; each sprite has different effect
    h['tntfall'] = (mult=1) => {
      // Only show/award UPGRADE via TNT from likes; avoid SUB/MEMBERSHIP unless actually achieved
      for (let i=0;i<mult;i++) {
        const likes = 1 + randInt(500);
        this._spawnBody({ type: 'tnt_fall', sheet: 'tnt', col: randInt(CONFIG.cols), color: '#ff4444', radiusFactor: 0.7, vx: (Math.random()-0.5)*120, vy: 0, likes });
      }
      this.sound.beep(160, 160, 'square');
    };
    return h;
  };

  // Build slices by splitting the atlas into a 4x4 grid
  Game.prototype._buildTextureSlices = function() {
    if (!this.textureAtlas) return;
    // Choose a tile size that evenly divides atlas dimensions
    const w = this.textureAtlas.width, h = this.textureAtlas.height;
    let tile = null;
    for (const cand of (CONFIG.blockTileCandidates || [16,32,64])) {
      if (w % cand === 0 && h % cand === 0) { tile = cand; break; }
    }
    if (!tile) {
      // Fallback: try to infer a reasonable grid (prefer square tiles)
      const approxCols = 8; const tileW = Math.floor(w / approxCols); const tileH = tileW; tile = Math.min(tileW, tileH);
    }
    const cols = Math.floor(w / tile);
    const rows = Math.floor(h / tile);
    this.textureSlices = [];
    for (let r=0;r<rows;r++) {
      for (let c=0;c<cols;c++) {
        this.textureSlices.push({ sx: c*tile, sy: r*tile, sw: tile, sh: tile });
      }
    }
    // Classify slices into soil/stone/ore based on average color and variance
    this._classifyBlockTextures?.();
  };

  // Analyze atlas tiles to classify brown soil, grey stone, and grey-with-speckles ore
  Game.prototype._classifyBlockTextures = function() {
    if (!this.textureAtlas || !this.textureSlices?.length) return;
    try {
      const slices = this.textureSlices;
      const off = document.createElement('canvas');
      const tile = slices[0].sw; off.width = tile; off.height = tile;
      const octx = off.getContext('2d');
      this.sliceAvgColors = new Array(slices.length).fill(null);
      const soil = [], stone = [], ore = [];
      const clamp01 = (v) => Math.max(0, Math.min(1, v));
      for (let i=0;i<slices.length;i++) {
        const s = slices[i];
        octx.clearRect(0,0,tile,tile);
        octx.drawImage(this.textureAtlas, s.sx, s.sy, s.sw, s.sh, 0, 0, tile, tile);
        const img = octx.getImageData(0,0,tile,tile);
        const d = img.data; let rSum=0,gSum=0,bSum=0,aSum=0; let count=0;
        const brights = []; // brightness list for variance/dots
        for (let p=0;p<d.length;p+=4) {
          const a = d[p+3]; if (a < 10) continue; // skip very transparent
          const r = d[p], g = d[p+1], b = d[p+2];
          rSum += r; gSum += g; bSum += b; aSum += a; count++;
          const bright = (r+g+b)/3; brights.push(bright);
        }
        if (!count) continue;
        const rAvg = rSum/count, gAvg = gSum/count, bAvg = bSum/count;
        this.sliceAvgColors[i] = { r: rAvg, g: gAvg, b: bAvg };
        const mean = (rAvg+gAvg+bAvg)/3;
        // compute stddev of brightness
        let varSum = 0; for (const v of brights) { const dv = v-mean; varSum += dv*dv; }
        const std = Math.sqrt(varSum / brights.length);
        const rg = Math.abs(rAvg-gAvg), rb = Math.abs(rAvg-bAvg), gb = Math.abs(gAvg-bAvg);
        const isGreyish = rg < 22 && rb < 22 && gb < 22;
        const isBrownish = (rAvg > gAvg) && (gAvg > bAvg) && rAvg > 90 && gAvg > 60 && bAvg < 90;
        if (isBrownish) soil.push(i);
        else if (isGreyish) {
          // distinguish ore (speckled) by higher std dev of brightness
          if (std >= 28) ore.push(i); else stone.push(i);
        }
      }
      this.textureClasses = { soil, stone, ore };
      // Fallbacks: if some categories end up empty, borrow from others
      const any = (arr) => arr && arr.length;
      if (!any(this.textureClasses.soil)) this.textureClasses.soil = this.textureClasses.stone?.slice(0,2) || [0];
      if (!any(this.textureClasses.stone)) this.textureClasses.stone = this.textureClasses.soil?.slice(0,2) || [0];
      if (!any(this.textureClasses.ore)) this.textureClasses.ore = this.textureClasses.stone?.slice(0,2) || [0];
    } catch (e) {
      // If analysis fails, leave classes undefined and rely on random assignment
      this.textureClasses = { soil: [], stone: [], ore: [] };
    }
  };

  // Find the texture slice index whose average color is closest to the given hex color
  Game.prototype._nearestTextureIndexForColor = function(hex) {
    const m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m || !this.sliceAvgColors?.length) return null;
    const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
    let bestIdx = null, bestDist = Infinity;
    for (let i=0;i<this.sliceAvgColors.length;i++) {
      const avg = this.sliceAvgColors[i]; if (!avg) continue;
      const dr = r - avg.r, dg = g - avg.g, db = b - avg.b;
      const dist = dr*dr + dg*dg + db*db;
      if (dist < bestDist) { bestDist = dist; bestIdx = i; }
    }
    return bestIdx;
  };

  // Build item slices dynamically to fit new icons sheet
  Game.prototype._buildItemSlices = function() {
    if (!this.itemAtlas) return;
    const w = this.itemAtlas.width, h = this.itemAtlas.height;
    const candidates = [16, 24, 32, 48, 64];
    let tile = null;
    for (const cand of candidates) { if (w % cand === 0 && h % cand === 0) { tile = cand; break; } }
    if (!tile) tile = 32; // sensible default
    const cols = Math.floor(w / tile), rows = Math.floor(h / tile);
    // Build all candidate slices
    const slices = [];
    for (let r=0;r<rows;r++) {
      for (let c=0;c<cols;c++) {
        slices.push({ sx: c*tile, sy: r*tile, sw: tile, sh: tile });
      }
    }
    // Filter out empty sprites (fully/mostly transparent)
    try {
      const off = document.createElement('canvas');
      off.width = tile; off.height = tile;
      const octx = off.getContext('2d');
      const isEmpty = (s) => {
        octx.clearRect(0,0,tile,tile);
        octx.drawImage(this.itemAtlas, s.sx, s.sy, s.sw, s.sh, 0, 0, tile, tile);
        const img = octx.getImageData(0,0,tile,tile);
        const data = img.data;
        let opaque = 0;
        for (let i=3;i<data.length;i+=4) { if (data[i] > 8) opaque++; }
        // Require at least 2% opaque pixels to be considered non-empty
        return opaque < (tile*tile*0.02);
      };
      this.itemSlices = slices.filter(s => !isEmpty(s));
    } catch (e) {
      // Fallback: if canvas getImageData is unavailable, use all slices
      this.itemSlices = slices;
    }
  };

  // Build TNT slices dynamically (tnt.png may have different tile size)
  Game.prototype._buildTntSlices = function() {
    if (!this.tntAtlas) return;
    const w = this.tntAtlas.width, h = this.tntAtlas.height;
    const cols = 9, rows = 5; // explicit 9x5 grid
    const tileW = w / cols;
    const tileH = h / rows;
    this.tntSlices = [];
    for (let r=0;r<rows;r++) {
      for (let c=0;c<cols;c++) {
        this.tntSlices.push({ sx: c*tileW, sy: r*tileH, sw: tileW, sh: tileH });
      }
    }
  };
})();
  // TNT finale: wild, varied spectacle and different looking explosions
  Game.prototype._tntFinale = function(cx, cy, spriteIndex=null) {
    // Increase shake
    this.shake = Math.min(1, (this.shake || 0) + 0.7);
    const mode = spriteIndex != null ? (spriteIndex % 8) : randInt(6);
    if (mode === 0) {
      // Whole row wipe
      this._rowBreak(cy);
      this._spawnSpectacleParticles(cx, cy, 80);
      this.sound.beep(140, 260, 'square');
    } else if (mode === 1) {
      // Circular delete explosion
      this._circleBreak(cx, cy, 5);
      this._spawnSpectacleParticles(cx, cy, 90);
      this.sound.beep(200, 280, 'triangle');
    } else if (mode === 2) {
      // Adjacent blocks become TNT (8-neighborhood)
      this._setAdjacentToTnt(cx, cy);
      this._spawnSpectacleParticles(cx, cy, 60);
      this.sound.beep(220, 220, 'sawtooth');
    } else if (mode === 3) {
      // Multi-stage: split into 2 clones twice, then finish
      this._multiStageSplit(cx, cy);
    } else if (mode === 4) {
      // Cross shock
      this._crossExplosion(cx, cy, 4 + randInt(3));
      this._spawnSpectacleParticles(cx, cy, 60);
      this.sound.beep(180, 220, 'triangle');
    } else if (mode === 5) {
      // Gravity block bomb: 10x10 circle becomes physics-based
      this._gravityBlockBomb(cx, cy, 10);
      this._spawnSpectacleParticles(cx, cy, 100);
      this.sound.beep(240, 240, 'sawtooth');
    } else if (mode === 6) {
      // Acid bomb: corrosive spread with probabilistic infection
      this._acidSpill(cx, cy, 0.5, 240);
      this._spawnSpectacleParticles(cx, cy, 60);
      this.sound.beep(160, 220, 'sawtooth');
    } else {
      // Chaos combo
      this._explosion(cx, cy, 2);
      this._crossExplosion(cx, cy, 5);
      this._rainbowExplosion(6);
      this._spawnSpectacleParticles(cx, cy, 120);
      this.sound.beep(160, 300, 'square');
    }
  };

  // Multi-stage split: spawn 2 clones twice, then finish with a boom
  Game.prototype._multiStageSplit = function(cx, cy) {
    const { size, offX, offY } = this._cellSize();
    const xPix = offX + cx * size + size/2;
    const yPix = offY + this.scrollOffset + cy * size + size/2;
    const spawnClones = (count) => {
      for (let i=0;i<count;i++) {
        const vx = (Math.random()-0.5) * 160;
        const vy = -60 - Math.random()*60;
        // Use a non-recursive variant (cross) to avoid infinite splitting
        this._spawnBody({ type: 'tnt_fall', sheet: 'tnt', color: '#ff4444', radiusFactor: 0.7, vx, vy, spriteIndex: 4, bounceTarget: 1, maxLifetimeSec: 6, x: xPix + (Math.random()-0.5)*size*0.8, y: yPix });
      }
    };
    spawnClones(2);
    setTimeout(() => spawnClones(2), 300);
    setTimeout(() => {
      this._explosion(cx, cy, 3);
      this._spawnSpectacleParticles(cx, cy, 100);
      this.sound.beep(120, 260, 'square');
    }, 650);
  };

  // Gravity block bomb: convert blocks in a circle to physics bodies
  Game.prototype._gravityBlockBomb = function(cx, cy, diam=10) {
    const radius = Math.floor(diam/2);
    const { size, offX, offY } = this._cellSize();
    for (let y=0;y<CONFIG.rows;y++) {
      for (let x=0;x<CONFIG.cols;x++) {
        const dx = x - cx, dy = y - cy;
        if (Math.sqrt(dx*dx + dy*dy) <= radius) {
          const cell = this.grid[y]?.[x];
          if (!cell?.alive) continue;
          const xPix = offX + x * size + size/2;
          const yPix = offY + this.scrollOffset + y * size + size/2;
          const colr = cell.color;
          this._breakOne(x, y, true);
          // Spawn a small physics body with the cell's color
          this._spawnBody({ type: 'orb', sheet: 'item', color: colr, radiusFactor: 0.35, vx: (Math.random()-0.5)*140, vy: -80, x: xPix, y: yPix });
        }
      }
    }
  };

  // Break an entire row y
  Game.prototype._rowBreak = function(y) {
    for (let x=0; x<CONFIG.cols; x++) {
      this._breakOne(x, y, true);
    }
    this._detachFloatingClusters?.();
  };

  // Set adjacent cells to TNT (8 directions)
  Game.prototype._setAdjacentToTnt = function(cx, cy) {
    // Convert a 5x5 neighborhood centered at (cx,cy) to TNT
    for (let dy=-2; dy<=2; dy++) {
      for (let dx=-2; dx<=2; dx++) {
        if (dx===0 && dy===0) continue;
        const x = cx + dx, y = cy + dy;
        if (x<0 || y<0 || x>=CONFIG.cols || y>=CONFIG.rows) continue;
        const cell = this.grid[y]?.[x];
        if (!cell) continue;
        this._addBlock(x, y, '#ff4444', 'tnt');
      }
    }
  };

  // Nuclear TNT: maximum destructive effect
  Game.prototype._tntNuke = function(cx, cy) {
    // Massive shake
    this.shake = Math.min(1, (this.shake || 0) + 1);
    // Layered devastation
    this._explosion(cx, cy, 4);
    this._crossExplosion(cx, cy, 7);
    this._rainbowExplosion(10);
    this._goldenExplosion(8);
    this._circleBreak(cx, cy, 6);
    this._spawnSpectacleParticles(cx, cy, 200);
    this.sound.beep(90, 400, 'sawtooth');
  };

  Game.prototype._spawnSpectacleParticles = function(cx, cy, count) {
    const colors = ['#ff5c5c','#f59e0b','#f7dd00','#43e97b','#3b82f6','#7c3aed','#ff77c8','#ffffff'];
    for (let i=0;i<count;i++) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 2 + Math.random() * 5;
      const p = {
        x: (this._cellSize().offX + cx * this._cellSize().size) + this._cellSize().size/2,
        y: (this._cellSize().offY + this.scrollOffset + cy * this._cellSize().size) + this._cellSize().size/2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 50 + randInt(50),
        lifeMax: 100,
        color: colors[randInt(colors.length)],
        size: 2 + randInt(2)
      };
      this.particles.push(p);
    }
  };
  // Acid spill: eats adjacent blocks and probabilistically infects neighbors
  Game.prototype._acidSpill = function(cx, cy, p=0.5, max=240) {
    const inb = (x,y) => x>=0 && y>=0 && x<CONFIG.cols && y<CONFIG.rows;
    const key = (x,y) => `${x},${y}`;
    const q = [];
    const visited = new Set();
    const dirs = [[1,0],[-1,0],[0,1],[0,-1]]; // 4-neighborhood to keep spread controlled
    // seed with immediate neighbors
    for (const [dx,dy] of dirs) {
      const nx = cx+dx, ny = cy+dy; if (!inb(nx,ny)) continue; q.push([nx,ny]); visited.add(key(nx,ny));
    }
    let count = 0;
    while (q.length && count < max) {
      const [x,y] = q.shift();
      const cell = this.grid[y]?.[x];
      if (!cell?.alive) continue;
      // corrode this block
      this._breakOne(x, y, true);
      // emit sickly green particles
      this._spawnParticles(x, y, 10 + randInt(10), '#7cff5f');
      count++;
      // probabilistically infect neighbors
      for (const [dx,dy] of dirs) {
        const nx = x+dx, ny = y+dy; if (!inb(nx,ny)) continue;
        if (visited.has(key(nx,ny))) continue;
        if (Math.random() < p) { q.push([nx,ny]); visited.add(key(nx,ny)); }
      }
    }
  };
  // Acid helpers
  Game.prototype._ensureAcidEngine = function() {
    if (this._acidInit) return;
    this._acidEffects = [];
    this._acidTickAccum = 0;
    this._acidInit = true;
  };

  Game.prototype._queueAcidEffect = function(cx, cy, ttl=5) {
    this._ensureAcidEngine();
    if (cx<0||cy<0||cx>=CONFIG.cols||cy>=CONFIG.rows) return;
    if (!this._acidEffects.some(e => e.cx===cx && e.cy===cy)) {
      this._acidEffects.push({ cx, cy, ttl });
      // prevent runaway growth
      if (this._acidEffects.length > 600) this._acidEffects = this._acidEffects.slice(-600);
    }
  };

  Game.prototype._corrodeSquare = function(cx, cy, half=1, infectNeighbors=true) {
    const inb = (x,y) => x>=0 && y>=0 && x<CONFIG.cols && y<CONFIG.rows;
    for (let dy=-half; dy<=half; dy++) {
      for (let dx=-half; dx<=half; dx++) {
        const x = cx + dx, y = cy + dy; if (!inb(x,y)) continue;
        const cell = this.grid[y]?.[x]; if (!cell?.alive) continue;
        this._breakOne(x, y, true);
        this._spawnParticles(x, y, 12 + randInt(12), '#7cff5f');
        if (infectNeighbors) {
          const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
          for (const [nx,ny] of dirs.map(([ix,iy]) => [x+ix, y+iy])) {
            if (!inb(nx,ny)) continue;
            if (Math.random() < 0.5) this._queueAcidEffect(nx, ny, 4);
          }
        }
      }
    }
  };

  // Corrode a 2x2 area starting at (cx,cy): (cx,cy),(cx+1,cy),(cx,cy+1),(cx+1,cy+1)
  Game.prototype._corrode2x2 = function(cx, cy, infectNeighbors=true) {
    const inb = (x,y) => x>=0 && y>=0 && x<CONFIG.cols && y<CONFIG.rows;
    for (let dy=0; dy<=1; dy++) {
      for (let dx=0; dx<=1; dx++) {
        const x = cx + dx, y = cy + dy; if (!inb(x,y)) continue;
        const cell = this.grid[y]?.[x]; if (!cell?.alive) continue;
        this._breakOne(x, y, true);
        this._spawnParticles(x, y, 10 + randInt(10), '#7cff5f');
        if (infectNeighbors) {
          const dirs = [[1,0],[-1,0],[0,1],[0,-1]];
          for (const [ix,iy] of dirs) {
            const nx = x+ix, ny = y+iy; if (!inb(nx,ny)) continue;
            if (Math.random() < 0.5) this._queueAcidEffect(nx, ny, 4);
          }
        }
      }
    }
  };

  Game.prototype._updateAcid = function(dt) {
    this._ensureAcidEngine();
    this._acidTickAccum += dt;
    while (this._acidTickAccum >= 1) {
      this._acidTickAccum -= 1;
      if (!this._acidEffects.length) break;
      const next = [];
      for (const node of this._acidEffects) {
        // 50/50: infect 3x3 square again, or destroy itself
        if (Math.random() < 0.5) {
          this._corrode2x2(node.cx, node.cy, true);
          node.ttl = (node.ttl ?? 5) - 1;
          if (node.ttl > 0) next.push(node);
        } else {
          // self-destroy: skip
        }
      }
      this._acidEffects = next;
    }
  };