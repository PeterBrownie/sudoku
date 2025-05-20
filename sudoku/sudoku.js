/*

"Vibe-coded" by Peter Brown in May 2025.

This is the main JavaScript file for the Sudoku game.

AI wrote all of this code, so I will not try to claim it as my own.

You can 100% use this code anyway you'd like under the following conditions:
1. You cannot claim it as your own.
2. You cannot prevent others from using it through any legal means or otherwise.

*/ 



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
  let clues = [];  // track original clues
  //let puzzleImported = false;  // initialize imported flag for mistake highlighting
  const indicatorEls = [];
  let gameCompleted = false;
  let hasGameStarted = false; // to track if a game has begun
  let timerStarted = false; // to track if the timer has started
  let timerInterval, startTime;
  let isPaused = false;
  let pausedElapsed = 0;  // Time elapsed at pause
  let isPauseAnimating = false;  // Prevent rapid pause/resume clicks
  let isPuzzleTransitioning = false;  //  track puzzle fade-in

  // Helper functions to yield control to the browser when idle
  function yieldIdle() {
    return new Promise(resolve => {
      if (window.requestIdleCallback) {
        requestIdleCallback(resolve);
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  function idleCallback(callback) {
    if (window.requestIdleCallback) {
      requestIdleCallback(callback);
    } else {
      setTimeout(callback, 0);
    }
  }

  // NEW: Global puzzle queue for difficulties 1-5.
  const puzzleQueue = { 1: [], 2: [], 3: [], 4: [], 5: [] };

  // NEW: Helper function to fill the puzzle queue for all difficulties in the background.
  function fillQueue() {
    console.log("Filling puzzle queue for all difficulties in the background...");
    for (let d = 1; d <= 5; d++) {
      console.log(`Checking queue for difficulty ${d}...`);
      if (puzzleQueue[d].length < 2) {
        console.log(`Queue for difficulty ${d} is short. Fetching new puzzles...`);
        idleCallback(() => {
          console.log(`Fetching puzzle for difficulty ${d}...`);
          window.puzzleGenerator.getPuzzle(d).then(result => {
            puzzleQueue[d].push(result);
            console.log(`Added puzzle for difficulty ${d}. Queue length: ${puzzleQueue[d].length}`);
          });
        });
      }
    }
  }

  // Modified generate() to serve a queued puzzle if available.
  async function generate() {
    console.log("Generating new puzzle...");
    isPuzzleTransitioning = true; // mark transition start
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
    await new Promise(resolve => setTimeout(resolve, 100)); // reduced delay

    // NEW: Call puzzle generator from external module
    const diff = Number(diffEl.value);
    let puzzleData;
    if (puzzleQueue[diff] && puzzleQueue[diff].length > 0) {
      console.log("Serving puzzle from queue...");
      puzzleData = puzzleQueue[diff].shift();
    } else {
      console.log("Fetching new puzzle...");
      puzzleData = await window.puzzleGenerator.getPuzzle(diff);
    }

    // Set global puzzle state
    solution = puzzleData.solution;
    puzzle = puzzleData.puzzle;
    clues = puzzleData.clues;
    timerStarted = false;

    render();

    await new Promise(resolve => setTimeout(resolve, 10));
    valueEls.forEach(el => el.classList.remove('fade-out'));
    indicatorContainers.forEach(el => el.classList.remove('fade-out'));
    isPuzzleTransitioning = false; // fade-in finished

    // Update the difficulty label based on grading result.
    document.getElementById('diffLabel').textContent = "Loading difficulty...";
    const puzzleStr = puzzle.map(cell => cell ? cell : '0').join('');
    const gradeObj = window.sudokuGrader && window.sudokuGrader.gradePuzzle
        ? window.sudokuGrader.gradePuzzle(puzzleStr)
        : { grade: 0 };
    document.getElementById('diffLabel').textContent = `Difficulty: ${gradeObj.grade.toFixed(2)}`;
    console.log("Puzzle difficulty: " + gradeObj.grade.toFixed(2));
    console.log("Going to fill the queue now...");
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
    // Replace text "C" with an SVG icon for clear
    clearBtn.innerHTML = `<svg fill='#FFFFFF' aria-hidden='true' width='20px' height='20px' viewBox='0 0 20 20' xmlns='http://www.w3.org/2000/svg'><path d='M9.15 7.15c.2-.2.5-.2.7 0L12 9.29l2.15-2.14a.5.5 0 0 1 .7.7L12.71 10l2.14 2.15a.5.5 0 0 1-.7.7L12 10.71l-2.15 2.14a.5.5 0 0 1-.7-.7L11.29 10 9.15 7.85a.5.5 0 0 1 0-.7ZM6.59 4.66A2.5 2.5 0 0 1 8.29 4h7.21A2.5 2.5 0 0 1 18 6.5v7a2.5 2.5 0 0 1-2.5 2.5H8.28a2.5 2.5 0 0 1-1.7-.66l-3.78-3.5a2.5 2.5 0 0 1 0-3.68l3.79-3.5Zm1.7.34c-.38 0-.75.14-1.03.4L3.48 8.9a1.5 1.5 0 0 0 0 2.2l3.78 3.5c.28.26.65.4 1.02.4h7.22c.83 0 1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5H8.28Z' fill='#FFFFFF'/></svg>`;
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

  // Update setValue to capture and return automatic candidate removals
  function setValue(i, n, actionID) {
    let removedCandidates = [];
    if (n) {
        removedCandidates = removeCandidatesPeersWithHistory(i, n, actionID);
    }
    puzzle[i] = n || null;
    candidates[i].clear();
    return removedCandidates;
  }

  // Update userSetValue to return the removedCandidates from setValue
  function userSetValue(i, n, actionID) {
    const removedCandidates = setValue(i, n, actionID);
    const cell = boardEl.children[i];
    const valueEl = cell.querySelector('.value');
    valueEl.classList.add('fade-in');
    setTimeout(() => {
        valueEl.classList.remove('fade-in');
    }, 300);
    return removedCandidates;
  }

  // NEW: Track secret pad sequence when no cell is selected
  let secretSequence = [];

  // global undo/redo arrays
  let undoStack = [];
  let redoStack = [];

  // NEW: Global action counter
  let actionCounter = 0;

  // Updated recordAction to attach uniqueActionID.
  function recordAction(action) {
    action.actionID = ++actionCounter;
    undoStack.push(action);
    redoStack = [];
    updateUndoRedoButtons();
  }

  // Undo last recorded action.
  function doUndo() {
    if (!undoStack.length) return;
    const action = undoStack.pop();
    if (action.type === "setValue") {
      puzzle[action.index] = action.prevValue;
      candidates[action.index] = new Set(action.prevCandidates);
      // Re-add candidates removed during this action.
      action.removedCandidates.forEach(removal => {
        candidates[removal.index].add(removal.candidate);
      });
    } else if (action.type === "toggleCandidate") {
      if (action.prevPresent) {
        candidates[action.index].add(action.candidate);
      } else {
        candidates[action.index].delete(action.candidate);
      }
    }
    render();
    redoStack.push(action);
    updateUndoRedoButtons();
  }

  // Redo next action.
  function doRedo() {
    if (!redoStack.length) return;
    const action = redoStack.pop();
    if (action.type === "setValue") {
      puzzle[action.index] = action.newValue;
      candidates[action.index] = new Set(action.newCandidates);
      // Remove candidates from peers again.
      action.removedCandidates.forEach(removal => {
        candidates[removal.index].delete(removal.candidate);
      });
    } else if (action.type === "toggleCandidate") {
      if (action.newPresent) {
        candidates[action.index].add(action.candidate);
      } else {
        candidates[action.index].delete(action.candidate);
      }
    }
    render();
    undoStack.push(action);
    updateUndoRedoButtons();
  }

  // NEW: Trigger barrel roll animation on all number pad buttons
  function triggerBarrelRoll() {
    const numberBtns = document.querySelectorAll('.pad-item button:not(.clear)');
    numberBtns.forEach(btn => {
      btn.classList.add('barrel-roll');
      btn.addEventListener('animationend', () => {
        btn.classList.remove('barrel-roll');
      }, { once: true });
    });
  }

  function onPadClick(n) {
    // NEW: If no cell is selected, process potential secret sequence as before.
    if (selected === null) {
      secretSequence.push(n);
      if (secretSequence.length > 4) secretSequence.shift();
      if (secretSequence.join('') === '6969') {
        triggerBarrelRoll();
        secretSequence = [];
      }
      return;
    }
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
    
    // For non-candidate mode (direct cell value changes).
    if (!candidateModeEl.checked) {
      // Block input if the same value is already present in the cell.
      if (n !== 0 && puzzle[selected] === n) return;
      // Record the action before applying it.
      const prevValue = puzzle[selected];
      const prevCandidates = Array.from(candidates[selected]);
      let action = {
        type: "setValue",
        index: selected,
        prevValue: prevValue,
        prevCandidates: prevCandidates,
        newValue: n,
        newCandidates: [],  // remains empty since candidates clear on value set
        removedCandidates: [] // will be filled next
      };
      recordAction(action);
      let removals = userSetValue(selected, n, action.actionID);
      action.removedCandidates = removals;
  }
    // For candidate mode.
    else {
      // NEW: Prevent candidate addition if the cell already has a value.
      if (puzzle[selected] !== null) {
        const cell = boardEl.children[selected];
        cell.classList.remove('shake');
        void cell.offsetWidth; // trigger reflow
        cell.classList.add('shake');
        cell.addEventListener('animationend', () => {
          cell.classList.remove('shake');
        }, { once: true });
        return;
      }
      const wasPresent = candidates[selected].has(n);
      recordAction({
        type: "toggleCandidate",
        index: selected,
        candidate: n,
        prevPresent: wasPresent,
        newPresent: !wasPresent
      });
      setCandidate(selected, n);
    }
    render();
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

  // NEW: removeCandidatesPeersWithHistory function to capture automatic removals
  function removeCandidatesPeersWithHistory(i, n, actionID) {
    const removed = [];
    const r = Math.floor(i/9), c = i % 9;
    const br = r - r % 3, bc = c - c % 3;
    const processed = new Set();
    for (let j = 0; j < 9; j++) {
      let idx1 = r * 9 + j;
      if (idx1 !== i && candidates[idx1].has(n) && !processed.has(idx1)) {
        candidates[idx1].delete(n);
        removed.push({ index: idx1, candidate: n, actionID: actionID });
        processed.add(idx1);
      }
      let idx2 = j * 9 + c;
      if (idx2 !== i && candidates[idx2].has(n) && !processed.has(idx2)) {
        candidates[idx2].delete(n);
        removed.push({ index: idx2, candidate: n, actionID: actionID });
        processed.add(idx2);
      }
    }
    for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) {
      let idx = (br+dr)*9 + (bc+dc);
      if (idx !== i && candidates[idx].has(n) && !processed.has(idx)) {
        candidates[idx].delete(n);
        removed.push({ index: idx, candidate: n, actionID: actionID });
        processed.add(idx);
      }
    }
    return removed;
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
      
      // NEW: Prevent celebration on initial load and after starting a new game by checking hasGameStarted.
      if (puzzle.length === 81 && puzzle.some(cell => cell !== null) && isSolved() && hasGameStarted && !gameCompleted) {
        clearInterval(timerInterval); // Pause the timer after game is completed
        gameCompleted = true;
        newGameBtn.classList.add("glow");
        startConfetti();
      } else if (!isSolved()) {
        newGameBtn.classList.remove("glow");
      }
    }

    function checkMistakes() {
      if (!solution || solution.length !== 81) return; // ensure final solution is available
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
        // Get current dot count without resetting innerHTML
        const currentDots = ind.children.length;
        if (currentDots < rem) {
          // Add missing dots with fade in.
          for (let i = currentDots; i < rem; i++) {
            const dot = document.createElement('div');
            dot.className = 'circle';
            dot.style.opacity = "0";
            ind.appendChild(dot);
            // Force reflow and then fade in.
            void dot.offsetWidth;
            dot.style.opacity = "1";
          }
        }
        else if (currentDots > rem) {
          // Remove extra dots with fade out.
          for (let i = currentDots - 1; i >= rem; i--) {
            const dot = ind.children[i];
            if (!dot) continue; // guard in case dot is undefined
            dot.style.opacity = "0";
            setTimeout(() => {
              if (dot.parentElement === ind) {
                ind.removeChild(dot);
              }
            }, 300); // delay matches css transition duration
          }
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
      isPuzzleTransitioning = true; // mark transition start
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
      
      // NEW: Call puzzle generator from external module
      const diff = Number(diffEl.value);
      const puzzleData = await window.puzzleGenerator.getPuzzle(diff);

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
      isPuzzleTransitioning = false; // fade-in finished

      // NEW: Set label to loading text before grading.
      document.getElementById('diffLabel').textContent = "Loading difficulty...";
      const puzzleStr = puzzle.map(cell => cell ? cell : '0').join('');
      const gradeObj = window.sudokuGrader && window.sudokuGrader.gradePuzzle 
                          ? window.sudokuGrader.gradePuzzle(puzzleStr)
                          : { grade: 0 };
      document.getElementById('diffLabel').textContent = `Difficulty: ${gradeObj.grade.toFixed(2)}`;
      
      // NEW: Refill the background queue for all difficulties.
      fillQueue();
    }

    function startTimer() {
      startTime = Date.now() - pausedElapsed;
      clearInterval(timerInterval);
      // Ensure timer is visible when starting
      document.getElementById('timer').classList.add('visible');
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
        // Toggle "visible" class to fade in/out the pause button
        if (elapsed >= 1000) {
          pauseBtn.classList.add('visible');
        } else {
          pauseBtn.classList.remove('visible');
        }
      }, 1000);
    }

    function resetTimer() {
      clearInterval(timerInterval);
      pausedElapsed = 0;
      document.getElementById('timer').textContent = '00:00';
      // Remove visible class so that the pause button fades out
      document.getElementById('pauseGame').classList.remove('visible');
      // Hide timer after reset
      document.getElementById('timer').classList.remove('visible');
    }

    // NEW: Pause button event listener
    document.getElementById('pauseGame').addEventListener('click', () => {
      // Prevent action if an animation is still in progress
      if (isPauseAnimating) return;
      isPauseAnimating = true;
      
      const boardContainer = document.getElementById('boardContainer');
      const padContainer = document.getElementById('padContainer');
      const pauseBtn = document.getElementById('pauseGame');
      if (!isPaused) {
        pausedElapsed = Date.now() - startTime;
        clearInterval(timerInterval);
        boardContainer.classList.add('paused');
        padContainer.classList.add('paused');
        pauseBtn.textContent = "Resume";
        isPaused = true;
        // Wait for the blurIn animation to finish before accepting new clicks
        boardContainer.addEventListener('animationend', () => {
          isPauseAnimating = false;
        }, { once: true });
      } else {
        startTimer();
        boardContainer.classList.add('unpausing');
        padContainer.classList.add('unpausing');
        boardContainer.addEventListener('animationend', () => {
          boardContainer.classList.remove('paused', 'unpausing');
          isPauseAnimating = false;
        }, { once: true });
        padContainer.addEventListener('animationend', () => {
          padContainer.classList.remove('paused', 'unpausing');
        }, { once: true });
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

    // New: open puzzle functionality.
    const openPuzzleBtn = document.getElementById('openPuzzle');
    openPuzzleBtn.addEventListener('click', () => {
      // Use the packing function to include candidate data.
      // Here, "X9B" (for example) is used as the prefix to signal candidate data.
      const packed = makePackedStringVB('S9B', true);
      const url = "https://www.sudokuwiki.org/sudoku.htm?bd=" + packed;
      window.open(url, '_blank');
    });

    // NEW: Import board functionality
    document.getElementById('importButton').addEventListener('click', () => {
      const importStr = document.getElementById('boardImport').value;
      if (importStr.length === 81 && /^[0-9.]+$/.test(importStr)) {
        const imported = importStr.split('').map(ch => (ch === '0' || ch === '.') ? null : Number(ch));
        puzzle = imported;
        clues = imported.map(v => v !== null);
        
        const gradeInput = importStr.replace(/\./g, '0');
        let result = window.sudokuGrader.gradePuzzle(gradeInput);
        if (typeof result !== 'object' || result === null) { 
          result = { grade: result };
        }
        document.getElementById('diffLabel').textContent = `Difficulty: ${result.grade.toFixed(2)}`;
        
        if (result.solvedGrid) {
          solution = result.solvedGrid.slice();
          if (hasUniqueSolution(imported)) {
            showMistakesEl.disabled = false;
            showMistakesEl.title = "";
            showMistakesEl.parentElement.style.color = "";
          }
        }
        if (!hasUniqueSolution(imported)) {
          showMistakesEl.checked = false;
          showMistakesEl.disabled = true;
          showMistakesEl.title = "Imported puzzle is ambiguous; mistakes not highlighted";
          showMistakesEl.parentElement.style.color = "#888";
        } else {
          showMistakesEl.disabled = false;
          showMistakesEl.title = "";
          showMistakesEl.parentElement.style.color = "";
        }
        // NEW: Mark the board as imported globally.
        window.puzzleImported = true;
        puzzleImported = true;
        render();
      }
    });

    // NEW: Updated function to pack board and candidate data
    function makePackedStringVB(prefix, withCandidates) {
        let s = prefix;
        for (let i = 0; i < 81; i++) {
            let n;
            if (puzzle[i] != null) {
                // Use the cell's value; add 0 if it is a given clue, 9 if not.
                n = puzzle[i] + (clues[i] ? 0 : 9);
            } else {
                let mask;
                // If candidate set is empty, assign full mask.
                if (candidates[i].size === 0) {
                    mask = (1 << 9) - 1; // full mask (511)
                } else {
                    mask = 0;
                    candidates[i].forEach(num => { mask |= (1 << (num - 1)); });
                    if (mask === 0) {
                        mask = (1 << 9) - 1;
                    }
                }
                n = mask + 18;
            }
            let h = n.toString(36);
            if (h.length < 2) h = '0' + h;
            s += h;
        }
        return s;
    }

    // NEW: Add function to update Undo/Redo button states (faded grey when disabled)
    function updateUndoRedoButtons() {
      const undoBtn = document.getElementById('undo');
      const redoBtn = document.getElementById('redo');
      if (undoStack.length === 0) {
        undoBtn.style.opacity = "0.5";
        undoBtn.disabled = true;
      } else {
        undoBtn.style.opacity = "1";
        undoBtn.disabled = false;
      }
      if (redoStack.length === 0) {
        redoBtn.style.opacity = "0.5";
        redoBtn.disabled = true;
      } else {
        redoBtn.style.opacity = "1";
        redoBtn.disabled = false;
      }
    }

    // Immediately update the buttons after initializing history arrays:
    updateUndoRedoButtons();

    document.getElementById('boardImport').addEventListener('input', function() {
      const importButton = document.getElementById('importButton');
      const importReason = document.getElementById('importReason');
      const value = this.value;
      const isValid = (value.length === 81 && /^[0-9.]+$/.test(value));
      importButton.disabled = !isValid;
      if (!isValid) {
          if (value.length !== 81) {
              importReason.textContent = "Board must be 81 characters long.";
          } else if (!/^[0-9.]+$/.test(value)) {
              importReason.textContent = "Board can only contain digits and periods.";
          } else {
              importReason.textContent = "";
          }
          importReason.style.display = "inline";
      } else {
          importReason.style.display = "none";
      }
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
      const numParticles = 250;
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
          // Modified: slow down confetti with a lower vertical speed.
          p.y += (Math.cos(p.d) + 2 + p.r/2) / 4;
          // Modified: reduce tilt multiplication for less blur.
          p.tilt = Math.sin(p.tiltAngle) * 8;
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
      if (isPuzzleTransitioning) return; // do nothing if puzzle is still fading in
      puzzleImported = false;  // <-- NEW: reset imported flag on new game
      showMistakesEl.disabled = false; // NEW: re-enable show mistakes checkbox
      showMistakesEl.title = "";       // NEW: clear tooltip text
      showMistakesEl.parentElement.style.color = ""; // NEW: reset label text color
      // Clear history for undo/redo
      undoStack = [];
      redoStack = [];
      updateUndoRedoButtons(); // disable undo (and redo) button on New Game
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
    
    // NEW: Close game options dropdown when clicking outside it
    document.addEventListener('click', e => {
      if (!e.target.closest('.game-options')) {
        const optionsBody = document.querySelector('.game-options-body');
        const header = document.querySelector('.game-options-header');
        if (optionsBody && optionsBody.classList.contains('expanded')) {
          optionsBody.classList.remove('expanded');
          header.classList.remove('expanded');
          const arrow = header.querySelector('.toggle-arrow');
          if (arrow) arrow.textContent = ' ▶';
        }
      }
    });

    // NEW: Add event listeners for Undo and Redo buttons.
    document.getElementById('undo').addEventListener('click', doUndo);
    document.getElementById('redo').addEventListener('click', doRedo);

    // Start by generating an immediate puzzle for the selected difficulty.
    generate();
  })();