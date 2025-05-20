// Puzzle generation logic moved from sudoku.js

export async function getPuzzle(diff) {
    const cluesArray = [56, 44, 35, 26, 17];
    const desiredClues = cluesArray[diff - 1];
    let sol = Array(81).fill(0);
    const rows = Array.from({ length: 9 }, () => new Set());
    const cols = Array.from({ length: 9 }, () => new Set());
    const boxes = Array.from({ length: 9 }, () => new Set());

    function shuffle(a) {
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function fill(i = 0) {
        if (i === 81) return true;
        const r = Math.floor(i / 9), c = i % 9;
        const b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
        const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
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
    let remainingClues = pus.filter(v => v !== null).length;
    let attempt = 0;
    for (const i of indices) {
      if (remainingClues <= desiredClues) break;
      attempt++;
      const backup = pus[i];
      if (backup !== null) {
        pus[i] = null;
        if (!hasUniqueSolution(pus.slice())) {
          pus[i] = backup;
        } else {
          remainingClues--;
        }
      }
      if (attempt % 50 === 0) {
        await yieldIdle();
      }
    }
    const clueFlags = pus.map(v => v !== null);

    // For level 5 puzzles, ensure the grade is -1 or greater than 40.
    if (diff === 5) {
        const puzzleStr = pus.map(cell => cell ? cell : '0').join('');
        let gradeObj = window.sudokuGrader && window.sudokuGrader.gradePuzzle
            ? window.sudokuGrader.gradePuzzle(puzzleStr)
            : { grade: 0 };
        if (typeof gradeObj !== 'object' || gradeObj === null) {
            gradeObj = { grade: gradeObj };
        }
        let notUnsolvable = (gradeObj.grade !== -1);
        let tooEasy = (gradeObj.grade <= 40);
        if (tooEasy && notUnsolvable) {
            return await getPuzzle(diff);
        }
    }
    return { puzzle: pus, solution: sol, clues: clueFlags };
}

function yieldIdle() {
    return new Promise(resolve => {
        if (window.requestIdleCallback) {
            requestIdleCallback(resolve);
        } else {
            setTimeout(resolve, 0);
        }
    });
}

function countSolutions(board) {
    let solutionCount = 0;
    function solve() {
        // pick the empty cell with the fewest valid numbers (MRV heuristic)
        let minOptions = 10;
        let idx = -1;
        for (let j = 0; j < 81; j++) {
          if (board[j] === null) {
            const r = Math.floor(j / 9), c = j % 9;
            let options = 0;
            for (let num = 1; num <= 9; num++) {
              if (isValid(board, r, c, num)) options++;
            }
            if (options < minOptions) {
              minOptions = options;
              idx = j;
              if (options <= 1) break;
            }
          }
        }
        // no empty cells means a full solution found
        if (idx === -1) {
          solutionCount++;
          return;
        }
        // prune if this cell has no possible candidates
        if (minOptions === 0) return;
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
    return countSolutions(board) === 1;
}

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
