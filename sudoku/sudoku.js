(() => {
  const boardEl = document.getElementById('board');
  const padEl = document.getElementById('pad');
  const newGameBtn = document.getElementById('newGame');
  const diffEl = document.getElementById('difficulty');
  const showMistakesEl = document.getElementById('showMistakes');
  const showConflictsEl = document.getElementById('showConflicts');
  const candidateModeEl = document.getElementById('candidateMode');

  let solution = [], puzzle = [], candidates = [];
  let selected = null;
  let clues = [];  // <-- NEW: track original clues
  const indicatorEls = [];
  let gameCompleted = false;
  let hasGameStarted = false; // new variable to track if a game has begun
  let timerStarted = false; // new variable to track if the timer has started
  let timerInterval, startTime;
  let isPaused = false;
  let pausedElapsed = 0;  // Time elapsed at pause

  // NEW: Global puzzle queue for difficulties 1-5
  const puzzleQueue = { 1: [], 2: [], 3: [], 4: [], 5: [] };

  // NEW: Extracted puzzle generation logic returning {puzzle, solution, clues}
  async function generatePuzzleData(diff) {
    const cluesArray = [56, 44, 35, 26, 17];
    const desiredClues = cluesArray[diff - 1];
    let sol = Array(81).fill(0);
    const rows = Array.from({ length: 9 }, () => new Set());
    const cols = Array.from({ length: 9 }, () => new Set());
    const boxes = Array.from({ length: 9 }, () => new Set());
    function fill(i = 0) {
      if (i === 81) return true;
      const r = Math.floor(i / 9), c = i % 9;
      const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
      const nums = shuffle([1,2,3,4,5,6,7,8,9]);
      for (const n of nums) {
        if (!rows[r].has(n) && !cols[c].has(n) && !boxes[b].has(n)) {
          rows[r].add(n);
          cols[c].add(n);
          boxes[b].add(n);
          sol[i] = n;
          if (fill(i + 1)) return true;
          rows[r].delete(n);
          cols[c].delete(n);
          boxes[b].delete(n);
        }
      }
      return false;
    }
    fill();
    
    let pus = sol.slice();
    const indices = shuffle([...Array(81).keys()]);
    for (const i of indices) {
      if (pus.filter(v => v !== null).length <= desiredClues) break;
      const backup = pus[i];
      pus[i] = null;
      if (!hasUniqueSolution(pus)) {
        pus[i] = backup;
      }
      await new Promise(resolve => setTimeout(resolve, 0));
    }
    const clueFlags = pus.map(v => v !== null);
    console.log("Background generated puzzle for diff " + diff + " with " + pus.filter(v => v !== null).length + " clues.");
    return { puzzle: pus, solution: sol, clues: clueFlags };
  }

  // NEW: Background queue fill function ensuring 2 puzzles per difficulty
  function fillQueue() {
    for (let d = 1; d <= 5; d++) {
      if (puzzleQueue[d].length < 4) {
        // Schedule generation in the background
        setTimeout(() => {
          generatePuzzleData(d).then(result => {
            puzzleQueue[d].push(result);
          });
        }, 0);
      }
    }
  }

  // Modified generate() to serve queued puzzle if available; otherwise generate immediately.
  async function generate() {
    // Immediately unselect any selected cell and trigger fade-out
    selected = null;
    render();
    const valueEls = document.querySelectorAll('.cell .value');
    const indicatorContainers = document.querySelectorAll('.count-indicator');
    if (valueEls.length) {
      valueEls.forEach(el => el.classList.add('fade-out'));
    }
    if (indicatorContainers.length) {
      indicatorContainers.forEach(el => el.classList.add('fade-out'));
    }
    await new Promise(resolve => setTimeout(resolve, 100)); // reduced delay

    // NEW: Use queued puzzle if available for the current diff.
    const diff = Number(diffEl.value);
    let puzzleData;
    if (puzzleQueue[diff].length > 0) {
      puzzleData = puzzleQueue[diff].shift();
    } else {
      puzzleData = await generatePuzzleData(diff);
    }
    // Set global puzzle state
    solution = puzzleData.solution;
    puzzle = puzzleData.puzzle;
    clues = puzzleData.clues;
    // Instead of marking game as started, reset timer control:
    timerStarted = false; // reset timer; it hasn't started yet for the new puzzle
    
    render();
    await new Promise(resolve => setTimeout(resolve, 10));
    valueEls.forEach(el => el.classList.remove('fade-out'));
    indicatorContainers.forEach(el => el.classList.remove('fade-out'));

    // NEW: Refill the background queue for all difficulties.
    fillQueue();
  }

  function buildBoard() {
    boardEl.innerHTML = '';
    candidates = Array(81).fill().map(() => new Set());
    for (let i = 0; i < 81; i++) {
      const r = Math.floor(i/9), c = i % 9;
      const cell = document.createElement('div');
      cell.className = 'cell';
      if (r % 3 === 0) cell.classList.add('border-top');
      if (r % 3 === 2) cell.classList.add('border-bottom');
      if (c % 3 === 0) cell.classList.add('border-left');
      if (c % 3 === 2) cell.classList.add('border-right');
      cell.dataset.index = i;
      cell.addEventListener('click', () => selectCell(i));

      const valEl = document.createElement('div');
      valEl.className = 'value';
      cell.appendChild(valEl);

      const candEl = document.createElement('div');
      candEl.className = 'candidates';
      for (let n = 1; n <= 9; n++) {
        const cd = document.createElement('div');
        cd.className = 'candidate';
        cd.textContent = n;
        candEl.appendChild(cd);
      }
      cell.appendChild(candEl);

      boardEl.appendChild(cell);
    }
  }

  function buildPad() {
    padEl.innerHTML = '';
    indicatorEls.length = 0;
    for (let n = 1; n <= 9; n++) {
      const item = document.createElement('div');
      item.className = 'pad-item';

      const btn = document.createElement('button');
      btn.textContent = n;
      btn.addEventListener('click', () => onPadClick(n));
      item.appendChild(btn);

      const ind = document.createElement('div');
      ind.className = 'count-indicator';
      item.appendChild(ind);

      padEl.appendChild(item);
      indicatorEls[n] = ind;
    }
    const clearItem = document.createElement('div');
    clearItem.className = 'pad-item';
    const clearBtn = document.createElement('button');
    clearBtn.textContent = 'C';
    clearBtn.className = 'clear';
    clearBtn.addEventListener('click', () => onPadClick(0));
    clearItem.appendChild(clearBtn);
    // no indicator for clear
    padEl.appendChild(clearItem);
  }

  function selectCell(idx) {
    // Allow selecting any cell, even a given clue.
    selected = idx;
    render();
  }

  function userSetValue(i, n) {
    setValue(i, n);
    const cell = boardEl.children[i];
    const valueEl = cell.querySelector('.value');
    valueEl.classList.add('fade-in');
    setTimeout(() => {
      valueEl.classList.remove('fade-in');
    }, 300);
  }

  function onPadClick(n) {
    if (selected === null) return;
    // If the selected cell is a given clue, trigger shake animation and block value entry.
    if (clues[selected]) {
        const cell = boardEl.children[selected];
        cell.classList.remove('shake');
        void cell.offsetWidth; // trigger reflow
        cell.classList.add('shake');
        cell.addEventListener('animationend', () => {
            cell.classList.remove('shake');
        }, { once: true });
        return;
    }
    if (!timerStarted) {
      startTimer();
      timerStarted = true;
    }
    if (!hasGameStarted) {
      hasGameStarted = true;
    }
    // Block input if the same value is already present in the cell (ignore candidate mode)
    if (n !== 0 && !candidateModeEl.checked && puzzle[selected] === n) return;
    
    if (n === 0) {
      userSetValue(selected, n);
    } else if (candidateModeEl.checked) {
      setCandidate(selected, n);
    } else {
      userSetValue(selected, n);
    }
    render();
  }

  function setValue(i, n) {
    puzzle[i] = n || null;
    candidates[i].clear();
    if (n) removeCandidatesPeers(i, n);
  }

  function setCandidate(i, n) {
    if (!n) return;
    candidates[i].has(n) ? candidates[i].delete(n) : candidates[i].add(n);
  }

  // NEW: autoCandidate function to fill each empty cell with all eligible candidates.
  function autoCandidate() {
    for (let i = 0; i < 81; i++) {
      if (puzzle[i] === null) {
        const r = Math.floor(i / 9), c = i % 9;
        candidates[i].clear();
        for (let n = 1; n <= 9; n++) {
          if (isValid(puzzle, r, c, n)) {
            candidates[i].add(n);
          }
        }
      }
    }
    render();
  }

  function removeCandidatesPeers(i, n) {
    const r = Math.floor(i/9), c = i % 9;
    const br = r - r % 3, bc = c - c % 3;
    for (let j = 0; j < 9; j++) {
      candidates[r*9 + j].delete(n);
      candidates[j*9 + c].delete(n);
    }
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) {
      candidates[(br+dr)*9 + bc+dc].delete(n);
    }
  }

  function render() {
    const cells = boardEl.children;
    for (let i = 0; i < 81; i++) {
          const cell = cells[i];
          const v = puzzle[i];
          cell.querySelector('.value').textContent = v || '';
          // Modified: use clues[i] instead of !!v to toggle original given style
          cell.classList.toggle('fixed', clues[i]);
          const candEls = cell.querySelectorAll('.candidate');
          candEls.forEach((cEl, idx) => {
              const hasCandidate = candidates[i].has(idx+1);
              cEl.style.opacity = hasCandidate ? '1' : '0';
              cEl.classList.toggle('highlight',
                  selected !== null &&
                  hasCandidate && // NEW: only highlight if candidate is still present
                  idx+1 === (puzzle[selected] || null)
              );
          });
          cell.classList.remove('highlight','duplicate','mistake','conflict');
          cell.classList.remove('selected','associated');
      }
      if (selected !== null) {
          const r = Math.floor(selected/9), c = selected % 9;
          const br = r - r % 3, bc = c - c % 3;
          // mark associated cells for row, column, and block
          for (let j = 0; j < 9; j++) {
              if (r * 9 + j !== selected) cells[r * 9 + j].classList.add('associated');
              if (j * 9 + c !== selected) cells[j * 9 + c].classList.add('associated');
          }
          for (let dr = 0; dr < 3; dr++) {
              for (let dc = 0; dc < 3; dc++) {
                  const idx = (br + dr) * 9 + bc + dc;
                  if (idx !== selected) cells[idx].classList.add('associated');
              }
          }
          // New: duplicate highlight for matching values
          if (puzzle[selected]) {
            for (let k = 0; k < 81; k++) {
              if (puzzle[k] === puzzle[selected] && k !== selected)
                cells[k].classList.add('duplicate');
            }
          }
          cells[selected].classList.remove('associated');
          cells[selected].classList.add('selected');
          // If candidate mode is enabled, add candidate-selected extra border style.
          if (candidateModeEl.checked) {
              cells[selected].classList.add('candidate-selected');
          } else {
              cells[selected].classList.remove('candidate-selected');
          }
      }
      updateIndicators();
      
      // NEW: Always highlight mistakes and conflicts regardless of cell selection.
      if (showMistakesEl.checked) checkMistakes();
      if (showConflictsEl.checked) checkConflicts();
      
      if (isSolved() && hasGameStarted && !gameCompleted) { // added hasGameStarted check
        clearInterval(timerInterval); // Pause the timer after game is completed
        gameCompleted = true;
        newGameBtn.classList.add("glow");
        startConfetti();
      } else if (!isSolved()) {
        newGameBtn.classList.remove("glow");
      }
    }

    function checkMistakes() {
      for (let i = 0; i < 81; i++) {
        const v = puzzle[i];
        if (v && v !== solution[i]) {
          boardEl.children[i].classList.add('mistake');
        }
      }
    }

    function checkConflicts() {
      for (let i = 0; i < 81; i++) {
        const v = puzzle[i];
        if (!v) continue;
        const r = Math.floor(i/9), c = i % 9;
        const br = r - r % 3, bc = c - c % 3;
        for (let j = 0; j < 9; j++) {
          if (j !== c && puzzle[r*9 + j] === v) boardEl.children[i].classList.add('conflict');
          if (j !== r && puzzle[j*9 + c] === v) boardEl.children[i].classList.add('conflict');
        }
        for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) {
          const idx = (br+dr)*9 + bc+dc;
          if (idx !== i && puzzle[idx] === v) boardEl.children[i].classList.add('conflict');
        }
      }
    }

    function updateIndicators() {
      // count how many times each number appears
      const counts = Array(10).fill(0);
      puzzle.forEach(v => { if (v) counts[v]++; });
      for (let n = 1; n <= 9; n++) {
        const rem = 9 - counts[n];
        const ind = indicatorEls[n];
        ind.innerHTML = '';
        for (let i = 0; i < rem; i++) {
          const dot = document.createElement('div');
          dot.className = 'circle';
          ind.appendChild(dot);
        }
      }
    }

    // Verifier helper functions:
    function isValid(board, row, col, num) {
      for (let j = 0; j < 9; j++) {
        if (board[row * 9 + j] === num) return false;
        if (board[j * 9 + col] === num) return false;
      }
      const br = Math.floor(row / 3) * 3, bc = Math.floor(col / 3) * 3;
      for (let r = br; r < br + 3; r++) {
        for (let c = bc; c < bc + 3; c++) {
          if (board[r * 9 + c] === num) return false;
        }
      }
      return true;
    }
    
    function countSolutions(board) {
      let solutionCount = 0;
      function solve() {
        const idx = board.findIndex(v => v === null);
        if (idx === -1) {
          solutionCount++;
          return;
        }
        const row = Math.floor(idx / 9), col = idx % 9;
        for (let num = 1; num <= 9; num++) {
          if (isValid(board, row, col, num)) {
            board[idx] = num;
            solve();
            if (solutionCount > 1) return;
            board[idx] = null;
          }
        }
      }
      solve();
      return solutionCount;
    }
    
    function hasUniqueSolution(board) {
      const boardCopy = board.slice();
      return countSolutions(boardCopy) === 1;
    }
    
    // Updated generate() with verifier and counter update.
    async function generate() {
      // Immediately unselect any selected cell and trigger fade out
      selected = null;
      render();
      const valueEls = document.querySelectorAll('.cell .value');
      const indicatorContainers = document.querySelectorAll('.count-indicator');
      if (valueEls.length) {
          valueEls.forEach(el => el.classList.add('fade-out'));
      }
      if (indicatorContainers.length) {
          indicatorContainers.forEach(el => el.classList.add('fade-out'));
      }
      // Reduced delay: start generating a new puzzle almost immediately
      await new Promise(resolve => setTimeout(resolve, 100)); // was 500

      // Optionally remove the following block or also reduce its timing
      const currentValues = document.querySelectorAll('.cell .value');
      if (currentValues.length) {
        currentValues.forEach(el => el.classList.add('fade-out'));
        await new Promise(resolve => setTimeout(resolve, 100)); // was 500
      }
      
      // NEW: Use queued puzzle if available for the current diff.
      const diff = Number(diffEl.value);
      let puzzleData;
      if (puzzleQueue[diff].length > 0) {
        puzzleData = puzzleQueue[diff].shift();
      } else {
        puzzleData = await generatePuzzleData(diff);
      }
      // Set global puzzle state
      solution = puzzleData.solution;
      puzzle = puzzleData.puzzle;
      clues = puzzleData.clues;
      // Instead of marking game as started, reset timer control:
      timerStarted = false; // reset timer; it hasn't started yet for the new puzzle
      
      // Render new board and then fade in numbers and indicators
      render();
      await new Promise(resolve => setTimeout(resolve, 10)); // minimal delay before fade in
      valueEls.forEach(el => el.classList.remove('fade-out'));
      indicatorContainers.forEach(el => el.classList.remove('fade-out'));

      // NEW: Refill the background queue for all difficulties.
      fillQueue();
    }

    function startTimer() {
      startTime = Date.now() - pausedElapsed;
      clearInterval(timerInterval);
      timerInterval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        let minutes = Math.floor(elapsed / 60000);
        let seconds = Math.floor((elapsed % 60000) / 1000);
        let displayTime;
        if (minutes >= 60) {
          const hours = Math.floor(minutes / 60);
          minutes = minutes % 60;
          displayTime = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        } else {
          displayTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        }
        document.getElementById('timer').textContent = displayTime;
        const pauseBtn = document.getElementById('pauseGame');
        // Hide pause button until elapsed time is at least 1 second
        pauseBtn.style.visibility = elapsed >= 1000 ? "visible" : "hidden";
      }, 1000);
    }

    function resetTimer() {
      clearInterval(timerInterval);
      pausedElapsed = 0;
      document.getElementById('timer').textContent = '00:00';
      document.getElementById('pauseGame').style.visibility = "hidden";
    }

    // NEW: Pause button event listener
    document.getElementById('pauseGame').addEventListener('click', () => {
      const boardContainer = document.getElementById('boardContainer');
      const padContainer = document.getElementById('padContainer');
      const pauseBtn = document.getElementById('pauseGame');
      if (!isPaused) {
        // Pause the timer and save elapsed time
        pausedElapsed = Date.now() - startTime;
        clearInterval(timerInterval);
        // Blur puzzle areas
        boardContainer.classList.add('paused');
        padContainer.classList.add('paused');
        pauseBtn.textContent = "Resume";
        isPaused = true;
      } else {
        // Resume the timer
        startTimer();
        boardContainer.classList.remove('paused');
        padContainer.classList.remove('paused');
        pauseBtn.textContent = "Pause";
        isPaused = false;
      }
    });

    // Reset timer when a new game is started
    newGameBtn.addEventListener('click', () => {
      resetTimer();
    });

    // New: copy puzzle functionality without text changes.
    const copyPuzzleBtn = document.getElementById('copyPuzzle');
    copyPuzzleBtn.addEventListener('click', () => {
      const puzzleText = puzzle.map(cell => cell ? cell : '.').join('');
      navigator.clipboard.writeText(puzzleText)
        .catch(err => console.error('Failed to copy puzzle: ', err));
    });

    function shuffle(a) {
      for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [a[i], a[j]] = [a[j], a[i]];
      }
      return a;
    }

    function isSolved() {
      return puzzle.every((v, i) => v !== null && v === solution[i]);
    }

    function startConfetti() {
      // Create canvas for confetti animation
      const canvas = document.createElement('canvas');
      canvas.id = 'confettiCanvas';
      canvas.style.position = 'fixed';
      canvas.style.top = '0';
      canvas.style.left = '0';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      canvas.style.pointerEvents = 'none';
      // Change z-index to place canvas behind all elements
      canvas.style.zIndex = '-1';
      document.body.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      const particles = [];
      const numParticles = 150;
      const colors = ['#FFC107', '#FF5722', '#4CAF50', '#2196F3', '#9C27B0'];
      
      for (let i = 0; i < numParticles; i++) {
        particles.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height - canvas.height,
          // Smaller particles: reduced radius range
          r: Math.random() * 2 + 1,
          d: Math.random() * numParticles,
          color: colors[Math.floor(Math.random() * colors.length)],
          tilt: Math.floor(Math.random() * 10) - 10,
          tiltAngleIncrement: Math.random() * 0.07 + 0.05,
          tiltAngle: 0
        });
      }
      
      let animationComplete = false;
      function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        particles.forEach(p => {
          p.tiltAngle += p.tiltAngleIncrement;
          p.y += (Math.cos(p.d) + 3 + p.r/2) / 2;
          p.tilt = Math.sin(p.tiltAngle) * 15;
          ctx.beginPath();
          ctx.lineWidth = p.r;
          ctx.strokeStyle = p.color;
          ctx.moveTo(p.x + p.tilt + p.r/2, p.y);
          ctx.lineTo(p.x + p.tilt, p.y + p.tilt + p.r/2);
          ctx.stroke();
        });
        if (!animationComplete) requestAnimationFrame(draw);
      }
      draw();
      // Remove confetti after 5 seconds
      setTimeout(() => {
        animationComplete = true;
        canvas.remove();
      }, 5000);
    }

    buildBoard();
    buildPad();
    newGameBtn.addEventListener('click', () => {
      // Clear all candidates for new game
      candidates = Array(81).fill().map(() => new Set());
      gameCompleted = false;
      hasGameStarted = false;
      newGameBtn.classList.remove("glow");
      resetTimer();
      generate();
    });
    diffEl.addEventListener('input', () => {
      // Clear all candidates when difficulty changes
      candidates = Array(81).fill().map(() => new Set());
      generate();
    });
    showMistakesEl.addEventListener('change', render);
    showConflictsEl.addEventListener('change', render);
    candidateModeEl.addEventListener('change', render);
    // NEW: Register Auto-Candidate button event listener.
    document.getElementById('autoCandidate').addEventListener('click', autoCandidate);
    
    // ← new: keyboard support for 1–9, 0/backspace = clear
    document.addEventListener('keydown', e => {
      // ignore if focus is in an input (so sliders, checkboxes still work)
      if (e.target.tagName === 'INPUT') return;

      // Toggle candidate mode on "C" key or space bar
      if (e.key.toLowerCase() === 'c' || e.key === ' ') {
        candidateModeEl.checked = !candidateModeEl.checked;
        render();
        e.preventDefault();
      }
      else if (e.key >= '1' && e.key <= '9') {
        onPadClick(Number(e.key));
        e.preventDefault();
      }
      else if (e.key === '0' || e.key === 'Backspace') {
        onPadClick(0);
        e.preventDefault();
      }
    });
    
    // Add background click listener to deselect cells
    document.addEventListener('click', e => {
      if (
        e.target.closest('#board') ||
        e.target.closest('.controls') ||
        e.target.closest('.pad-container') ||
        e.target.closest('.candidate-toggle')
      ) {
        return;
      }
      selected = null;
      render();
    });
    
    // Start by generating an immediate puzzle for the selected difficulty.
    generate();
    
    // Initially fill queue for all difficulties.
    fillQueue();
  })();