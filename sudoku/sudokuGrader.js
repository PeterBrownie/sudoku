// sudokuGrader.js

// THIS CODE IS BROKEN. I know this for a fact, I've seen this thing use bad logic.
// I am yet to find the problem.

/*

"Vibe-coded" by Peter Brown in May 2025.

This is a Sudoku puzzle grading function that 
evaluates the difficulty of a given Sudoku puzzle.

AI wrote all of this code, so I will not try to claim it as my own.

You can 100% use this code anyway you'd like under the following conditions:
1. You cannot claim it as your own.
2. You cannot prevent others from using it through any legal means or otherwise.

*/ 

// Global candidate map for use in all techniques
let candidates = [];
export let snapshots = [];
// Track which X-Wing patterns have already been applied to avoid duplicates
let seenXWings = new Set();

// Technique definitions: name, level, weight, apply(grid)
const techniqueTiers = [
  {
    name: 'Naked Single',
    level: 1,
    weight: 1,
    apply: applyNakedSingle
  },
  {
    name: 'Hidden Single',
    level: 2,
    weight: 1.5,
    apply: applyHiddenSingle
  },
  {
    name: 'Locked Candidate',
    level: 3,
    weight: 1.5,
    apply: applyLockedCandidate
  },
  {
    name: 'Pointing Pair',
    level: 1.5,
    weight: 2,
    apply: applyPointingPairs
  },
  {
    name: 'Box/Line Reduction',
    level: 3,
    weight: 2,
    apply: applyBoxLineReduction
  },
  {
    name: 'Naked Pair',
    level: 2,
    weight: 2,
    apply: applyNakedPair
  },
  {
    name: 'Naked Triple',
    level: 1.5,
    weight: 3,
    apply: applyNakedTriple
  },
  {
    name: 'X-Wing',
    level: 5,
    weight: 5,
    apply: applyXWing
  },
  {
    name: 'Unique Rectangle',
    level: 4,
    weight: 3,
    apply: applyUniqueRectangle
  },
  {
    name: 'Simple Coloring',
    level: 5,
    weight: 4,
    apply: applySimpleColoring
  },
  // ← you can add Locked Candidates, X-Wing, etc. here
];

console.log("sudokuGrader module loaded");

// NEW: Add helper to check if inserting num at idx is valid.
function isValidCell(grid, idx, num) {
    const r = Math.floor(idx / 9), c = idx % 9;
    // Row
    for (let j = r * 9; j < r * 9 + 9; j++) {
        if (grid[j] === num) return false;
    }
    // Column
    for (let j = c; j < 81; j += 9) {
        if (grid[j] === num) return false;
    }
    // Box
    const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
    for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) {
            if (grid[(br + dr) * 9 + (bc + dc)] === num) return false;
        }
    }
    return true;
}

// NEW: Helper to update candidate lists for all peers of index 'idx'
function updatePeers(grid, idx, value) {
    const r = Math.floor(idx / 9), c = idx % 9;
    // Update row
    for (let j = r * 9; j < r * 9 + 9; j++) {
        if (grid[j] === 0) {
            candidates[j] = candidates[j].filter(n => n !== value);
        }
    }
    // Update column
    for (let j = c; j < 81; j += 9) {
        if (grid[j] === 0) {
            candidates[j] = candidates[j].filter(n => n !== value);
        }
    }
    // Update box
    const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
    for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) {
            const peerIdx = (br + dr) * 9 + (bc + dc);
            if (grid[peerIdx] === 0) {
                candidates[peerIdx] = candidates[peerIdx].filter(n => n !== value);
            }
        }
    }
}

// ------------- Technique: Naked Single -------------
function applyNakedSingle(grid) {
  let count = 0;
  for (let i = 0; i < 81; i++) {
    if (grid[i] === 0) {
      const cand = candidates[i];
      if (cand.length === 1) {
        // Only fill if valid (even though computeCandidates should guarantee it)
        if (isValidCell(grid, i, cand[0])) {
          grid[i] = cand[0];
          candidates[i] = [];
          // NEW: Update candidates in peer cells after inserting value
          updatePeers(grid, i, cand[0]);
          count++;
          snapshots.push({
            step: snapshots.length + 1,
            technique: 'Naked Single',
            cell: i,
            filled: cand[0],
            grid: grid.slice(),
            candidates: candidates.map(arr => arr.slice())
          });
        } else {
          // Bad candidate detected: copy snapshots immediately for debugging.
          copySnapshotsToClipboard();
        }
      }
    }
  }
  return count;
}

// ------------- Technique: Hidden Single -------------
function applyHiddenSingle(grid) {
  let count = 0;
  // Helper to process one unit (array of 9 indices)
  function processUnit(unit) {
    const unitCands = unit.map(i => candidates[i]);
    for (let d = 1; d <= 9; d++) {
      const positions = [];
      for (let j = 0; j < 9; j++) {
        if (grid[unit[j]] === 0 && unitCands[j].includes(d)) {
          positions.push(unit[j]);
        }
      }
      // Only place if the candidate is unique in the unit and valid
      if (positions.length === 1 && isValidCell(grid, positions[0], d)) {
        grid[positions[0]] = d;
        candidates[positions[0]] = [];
        // NEW: update candidate lists in peers after inserting value
        updatePeers(grid, positions[0], d);
        count++;
      } else if (positions.length === 1) {
        // Candidate found not valid – copy snapshots for debugging.
        copySnapshotsToClipboard();
      }
    }
  }

  // Rows, Cols, Boxes
  for (let r = 0; r < 9; r++) processUnit(Array.from({ length: 9 }, (_, k) => r * 9 + k));
  for (let c = 0; c < 9; c++) processUnit(Array.from({ length: 9 }, (_, k) => c + 9 * k));
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const unit = [];
      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) {
          unit.push((3 * br + dr) * 9 + (3 * bc + dc));
        }
      }
      processUnit(unit);
    }
  }
  if (count > 0) {
    snapshots.push({
      step: snapshots.length + 1,
      technique: 'Hidden Single',
      grid: grid.slice(),
      candidates: candidates.map(arr => arr.slice())
    });
  }
  return count;
}

// ------------- Technique: Locked Candidate (Pointing / Claiming) -------------
function applyLockedCandidate(grid) {
  let count = 0;
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const boxIdxs = [];
      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) {
          const idx = (3 * br + dr) * 9 + (3 * bc + dc);
          if (grid[idx] === 0) boxIdxs.push(idx);
        }
      }
      for (let d = 1; d <= 9; d++) {
        const pos = boxIdxs.filter(i => computeCandidates(grid, i).includes(d));
        if (pos.length >= 2) {
          const rows = new Set(pos.map(i => Math.floor(i / 9)));
          if (rows.size === 1) {
            const r = [...rows][0];
            for (let j = r * 9; j < r * 9 + 9; j++) {
              if (!boxIdxs.includes(j) && grid[j] === 0 && candidates[j].includes(d)) {
                candidates[j] = candidates[j].filter(x => x !== d);
                count++;
              }
            }
          }
          const cols = new Set(pos.map(i => i % 9));
          if (cols.size === 1) {
            const c = [...cols][0];
            for (let j = c; j < 81; j += 9) {
              if (!boxIdxs.includes(j) && grid[j] === 0 && candidates[j].includes(d)) {
                candidates[j] = candidates[j].filter(x => x !== d);
                count++;
              }
            }
          }
        }
      }
    }
  }
  if (count > 0) {
    snapshots.push({
      step: snapshots.length + 1,
      technique: 'Locked Candidate',
      grid: grid.slice(),
      candidates: candidates.map(arr => arr.slice())
    });
  }
  return count;
}

// ------------- Technique: Pointing Pair -------------
function applyPointingPairs(grid) {
  let count = 0;
  // For each 3×3 box:
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const boxIdxs = [];
      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) {
          const idx = (3 * br + dr) * 9 + (3 * bc + dc);
          if (grid[idx] === 0) boxIdxs.push(idx);
        }
      }
      for (let d = 1; d <= 9; d++) {
        const pos = boxIdxs.filter(i => candidates[i].includes(d));
        // All in one row
        const rows = new Set(pos.map(i => Math.floor(i / 9)));
        if (pos.length >= 2 && rows.size === 1) {
          const r = [...rows][0];
          for (let j = r * 9; j < r * 9 + 9; j++) {
            if (!boxIdxs.includes(j) && grid[j] === 0 && candidates[j].includes(d)) {
              candidates[j] = candidates[j].filter(x => x !== d);
              count++;
            }
          }
        }
        // All in one column
        const cols = new Set(pos.map(i => i % 9));
        if (pos.length >= 2 && cols.size === 1) {
          const c = [...cols][0];
          for (let j = c; j < 81; j += 9) {
            if (!boxIdxs.includes(j) && grid[j] === 0 && candidates[j].includes(d)) {
              candidates[j] = candidates[j].filter(x => x !== d);
              count++;
            }
          }
        }
      }
    }
  }
  if (count > 0) {
    snapshots.push({
      step: snapshots.length + 1,
      technique: 'Pointing Pair',
      grid: grid.slice(),
      candidates: candidates.map(arr => arr.slice())
    });
  }
  return count;
}

// ------------- Technique: Box/Line Reduction -------------
function applyBoxLineReduction(grid) {
  let count = 0;
  // Row-based reductions
  for (let d = 1; d <= 9; d++) {
    for (let r = 0; r < 9; r++) {
      const rowCells = Array.from({ length: 9 }, (_, k) => r * 9 + k)
        .filter(i => grid[i] === 0 && candidates[i].includes(d));
      if (rowCells.length > 1) {
        const boxRow = Math.floor(rowCells[0] / 27);
        const boxCol = Math.floor((rowCells[0] % 9) / 3);
        if (rowCells.every(i => Math.floor(i / 27) === boxRow && Math.floor((i % 9) / 3) === boxCol)) {
          for (let dr = 0; dr < 3; dr++) {
            for (let dc = 0; dc < 3; dc++) {
              const idx = (boxRow * 3 + dr) * 9 + (boxCol * 3 + dc);
              if (grid[idx] === 0 && !rowCells.includes(idx) && candidates[idx].includes(d)) {
                candidates[idx] = candidates[idx].filter(x => x !== d);
                count++;
              }
            }
          }
        }
      }
    }
  }
  // Column-based reductions
  for (let d = 1; d <= 9; d++) {
    for (let c = 0; c < 9; c++) {
      const colCells = Array.from({ length: 9 }, (_, k) => c + 9 * k)
        .filter(i => grid[i] === 0 && candidates[i].includes(d));
      if (colCells.length > 1) {
        const boxRow = Math.floor(colCells[0] / 27);
        const boxCol = Math.floor((colCells[0] % 9) / 3);
        if (colCells.every(i => Math.floor(i / 27) === boxRow && Math.floor((i % 9) / 3) === boxCol)) {
          for (let dr = 0; dr < 3; dr++) {
            for (let dc = 0; dc < 3; dc++) {
              const idx = (boxRow * 3 + dr) * 9 + (boxCol * 3 + dc);
              if (grid[idx] === 0 && !colCells.includes(idx) && candidates[idx].includes(d)) {
                candidates[idx] = candidates[idx].filter(x => x !== d);
                count++;
              }
            }
          }
        }
      }
    }
  }
  if (count > 0) {
    snapshots.push({
      step: snapshots.length + 1,
      technique: 'Box/Line Reduction',
      grid: grid.slice(),
      candidates: candidates.map(arr => arr.slice())
    });
  }
  return count;
}

// ------------- Technique: Naked Pair -------------
function applyNakedPair(grid) {
  let count = 0;
  const units = [];
  // Rows
  for (let r = 0; r < 9; r++) {
    units.push(Array.from({ length: 9 }, (_, k) => r * 9 + k));
  }
  // Columns
  for (let c = 0; c < 9; c++) {
    units.push(Array.from({ length: 9 }, (_, k) => c + 9 * k));
  }
  // 3x3 Boxes
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const box = [];
      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) {
          box.push((3 * br + dr) * 9 + (3 * bc + dc));
        }
      }
      units.push(box);
    }
  }

  // Identify and process naked pairs
  for (const unit of units) {
    // Collect cells with exactly two candidates
    const pairCells = unit.filter(i => grid[i] === 0 && candidates[i].length === 2);
    const seen = {};
    // Group cells by their two-candidate key
    for (const idx of pairCells) {
      const key = candidates[idx].slice().sort().join(',');
      (seen[key] = seen[key] || []).push(idx);
    }
    // For each candidate pair found exactly twice, eliminate those digits from other cells in the unit
    for (const key in seen) {
      const idxs = seen[key];
      if (idxs.length === 2) {
        const nums = key.split(',').map(n => parseInt(n, 10));
        for (const idx of unit) {
          if (!idxs.includes(idx) && grid[idx] === 0) {
            nums.forEach(num => {
              if (candidates[idx].includes(num)) {
                candidates[idx] = candidates[idx].filter(d => d !== num);
                count++;
              }
            });
          }
        }
      }
    }
  }

  // Record a snapshot if any eliminations were made
  if (count > 0) {
    snapshots.push({
      step: snapshots.length + 1,
      technique: 'Naked Pair',
      grid: grid.slice(),
      candidates: candidates.map(arr => arr.slice())
    });
  }
  return count;
}

// ------------- Technique: Naked Triple -------------
function applyNakedTriple(grid) {
  let count = 0;
  // Build all units: rows, columns, boxes
  const units = [];
  for (let r = 0; r < 9; r++) units.push(Array.from({ length: 9 }, (_, k) => r * 9 + k));
  for (let c = 0; c < 9; c++) units.push(Array.from({ length: 9 }, (_, k) => c + 9 * k));
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const box = [];
      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) {
          box.push((3 * br + dr) * 9 + (3 * bc + dc));
        }
      }
      units.push(box);
    }
  }
  // Process each unit for naked triples
  for (const unit of units) {
    const unsolved = unit.filter(i => grid[i] === 0);
    for (let a = 0; a < unsolved.length - 2; a++) {
      for (let b = a + 1; b < unsolved.length - 1; b++) {
        for (let c = b + 1; c < unsolved.length; c++) {
          const i = unsolved[a], j = unsolved[b], k = unsolved[c];
          const candA = computeCandidates(grid, i);
          const candB = computeCandidates(grid, j);
          const candC = computeCandidates(grid, k);
          const unionSet = new Set([...candA, ...candB, ...candC]);
          if (unionSet.size === 3 &&
              candA.every(d => unionSet.has(d)) &&
              candB.every(d => unionSet.has(d)) &&
              candC.every(d => unionSet.has(d))) {
            for (const idx of unit) {
              if (idx === i || idx === j || idx === k) continue;
              const before = candidates[idx].length;
              candidates[idx] = candidates[idx].filter(d => !unionSet.has(d));
              const removed = before - candidates[idx].length;
              if (removed > 0) {
                count += removed;
              }
            }
          }
        }
      }
    }
  }
  if (count > 0) {
    snapshots.push({
      step: snapshots.length + 1,
      technique: 'Naked Triple',
      grid: grid.slice(),
      candidates: candidates.map(arr => arr.slice())
    });
  }
  return count;
}

// ------------- Technique: X-Wing -------------
function applyXWing(grid) {
  let count = 0;
  // Track seen patterns to avoid duplicates
  if (!seenXWings) seenXWings = new Set();
  for (let d = 1; d <= 9; d++) {
    // Map digit to rows where it appears exactly twice
    const rowPositions = Array.from({ length: 9 }, () => []);
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const idx = r * 9 + c;
        if (grid[idx] === 0 && candidates[idx].includes(d)) {
          rowPositions[r].push(c);
        }
      }
    }
    // Look for pairs of rows with identical two columns
    for (let r1 = 0; r1 < 8; r1++) {
      if (rowPositions[r1].length !== 2) continue;
      for (let r2 = r1 + 1; r2 < 9; r2++) {
        if (rowPositions[r2].length === 2 &&
            rowPositions[r1][0] === rowPositions[r2][0] &&
            rowPositions[r1][1] === rowPositions[r2][1]) {
          const [c1, c2] = rowPositions[r1];
          const key = `${d}-${r1}-${r2}-${c1}-${c2}`;
          if (seenXWings.has(key)) continue;
          seenXWings.add(key);
          // Eliminate candidate d from other rows in those columns
          for (let r3 = 0; r3 < 9; r3++) {
            if (r3 === r1 || r3 === r2) continue;
            [c1, c2].forEach(c => {
              const idx = r3 * 9 + c;
              if (grid[idx] === 0 && candidates[idx].includes(d)) {
                candidates[idx] = candidates[idx].filter(x => x !== d);
                count++;
              }
            });
          }
        }
      }
    }
  }
  if (count > 0) {
    snapshots.push({
      step: snapshots.length + 1,
      technique: 'X-Wing',
      grid: grid.slice(),
      candidates: candidates.map(arr => arr.slice())
    });
  }
  return count;
}


// ------------- Technique: Unique Rectangle -------------
function applyUniqueRectangle(grid) {
  let count = 0;
  // Iterate over all pairs of rows and columns to find rectangles
  for (let r1 = 0; r1 < 8; r1++) {
    for (let r2 = r1 + 1; r2 < 9; r2++) {
      for (let c1 = 0; c1 < 8; c1++) {
        for (let c2 = c1 + 1; c2 < 9; c2++) {
          const idxs = [
            r1 * 9 + c1,
            r1 * 9 + c2,
            r2 * 9 + c1,
            r2 * 9 + c2
          ];
          // Ensure all four cells are unsolved
          if (idxs.every(i => grid[i] === 0)) {
            const lists = idxs.map(i => candidates[i]);
            // Identify rectangles where three cells are bi-value with the same two candidates
            if (lists.filter(l => l.length === 2 && l[0] === lists[0][0] && l[1] === lists[0][1]).length === 3) {
              const common = lists[0];
              // Find the cell with extra candidates
              const extraIdx = idxs.find(i => candidates[i].length > 2 && common.every(d => candidates[i].includes(d)));
              if (extraIdx !== undefined) {
                const before = candidates[extraIdx].length;
                // Eliminate all non-common candidates
                candidates[extraIdx] = candidates[extraIdx].filter(d => common.includes(d));
                count += before - candidates[extraIdx].length;
              }
            }
          }
        }
      }
    }
  }
  if (count > 0) {
    snapshots.push({
      step: snapshots.length + 1,
      technique: 'Unique Rectangle',
      grid: grid.slice(),
      candidates: candidates.map(arr => arr.slice())
    });
  }
  return count;
}

// ------------- Helper: sharesUnit -------------
function sharesUnit(i, j) {
  // same row
  if (Math.floor(i / 9) === Math.floor(j / 9)) return true;
  // same column
  if (i % 9 === j % 9) return true;
  // same box
  const br1 = Math.floor(i / 27), bc1 = Math.floor((i % 9) / 3);
  const br2 = Math.floor(j / 27), bc2 = Math.floor((j % 9) / 3);
  return br1 === br2 && bc1 === bc2;
}

// ------------- Technique: Simple Coloring -------------
function applySimpleColoring(grid) {
  let count = 0;
  for (let d = 1; d <= 9; d++) {
    // collect all cells with candidate d
    const candPos = [];
    for (let idx = 0; idx < 81; idx++) {
      if (grid[idx] === 0 && candidates[idx].includes(d)) {
        candPos.push(idx);
      }
    }
    if (candPos.length === 0) continue;
    // build strong-link adjacency
    const links = {};
    candPos.forEach(idx => links[idx] = []);
    // rows, columns, boxes
    for (let r = 0; r < 9; r++) {
      const row = candPos.filter(idx => Math.floor(idx / 9) === r);
      if (row.length === 2) {
        links[row[0]].push(row[1]);
        links[row[1]].push(row[0]);
      }
    }
    for (let c = 0; c < 9; c++) {
      const col = candPos.filter(idx => idx % 9 === c);
      if (col.length === 2) {
        links[col[0]].push(col[1]);
        links[col[1]].push(col[0]);
      }
    }
    for (let br = 0; br < 3; br++) {
      for (let bc = 0; bc < 3; bc++) {
        const box = candPos.filter(idx =>
          Math.floor(idx / 27) === br &&
          Math.floor((idx % 9) / 3) === bc
        );
        if (box.length === 2) {
          links[box[0]].push(box[1]);
          links[box[1]].push(box[0]);
        }
      }
    }
    // traverse each connected component separately
    const visited = new Set();
    for (const start of candPos) {
      if (visited.has(start)) continue;
      // BFS color this component
      const queue = [start];
      const colorMap = { [start]: 'A' };
      const compA = [start];
      const compB = [];
      visited.add(start);
      while (queue.length) {
        const u = queue.shift();
        const nextColor = colorMap[u] === 'A' ? 'B' : 'A';
        for (const v of links[u]) {
          if (!visited.has(v)) {
            visited.add(v);
            colorMap[v] = nextColor;
            if (nextColor === 'A') compA.push(v);
            else compB.push(v);
            queue.push(v);
          }
        }
      }
      // elimination: check each color group in this component
      for (const group of [compA, compB]) {
        let eliminated = false;
        for (let i = 0; i < group.length - 1 && !eliminated; i++) {
          for (let j = i + 1; j < group.length; j++) {
            if (sharesUnit(group[i], group[j])) {
              // eliminate candidate d from all nodes of this color in this component
              for (const idx of group) {
                if (candidates[idx].includes(d)) {
                  candidates[idx] = candidates[idx].filter(x => x !== d);
                  count++;
                }
              }
              eliminated = true;
              break;
            }
          }
        }
      }
    }
  }
  if (count > 0) {
    snapshots.push({
      step: snapshots.length + 1,
      technique: 'Simple Coloring',
      grid: grid.slice(),
      candidates: candidates.map(arr => arr.slice())
    });
  }
  return count;
}

// ------------- Technique: Backtracking -------------
function backtrackingSolve(origGrid) {
  const grid = origGrid.slice();  // copy
  let nodes = 0, maxDepth = 0;
  let solvedGrid = null; // store solved board

  function dfs(depth = 1) {
    nodes++;
    maxDepth = Math.max(maxDepth, depth);

    // Find first empty
    let idx = grid.findIndex(v => v === 0);
    if (idx === -1) {
      solvedGrid = grid.slice();
      return true;  // solved the puzzle
    }

    const cand = computeCandidates(grid, idx);
    for (const d of cand) {
      grid[idx] = d;
      if (dfs(depth + 1)) return true;
    }
    grid[idx] = 0;  // backtrack
    return false;
  }

  dfs();
  console.log("Backtracking solved board:", solvedGrid);
  return { depth: maxDepth, nodes, solvedGrid };
}

// Main entry point
export function gradePuzzle(puzzleString) {
  // reset snapshots on each run
  snapshots = [];
  console.log("gradePuzzle invoked with puzzleString:", puzzleString);
  if (puzzleString.length !== 81) {
    throw new Error('Puzzle string must be exactly 81 characters');
  }
  const grid = Array.from(puzzleString, ch => parseInt(ch, 10));
  console.log("Parsed grid:", grid);
  
  // Build initial candidates map
  candidates = Array.from({ length: 81 }, (_, i) =>
    grid[i] === 0 ? computeCandidates(grid, i) : []
  );
  // Function to refresh all candidates
  function updateCandidates() {
    for (let j = 0; j < 81; j++) {
      candidates[j] = grid[j] === 0 ? computeCandidates(grid, j) : [];
    }
  }
  // Initialize candidates
  updateCandidates();
  
  let maxLevel = 0;
  let totalWeight = 0;
  let finalSolvedGrid = null;  // NEW: track solved grid

  // 1. Pure-logic loop with endless loop safeguard
  let progress;
  let iterationCount = 0;
  const iterationLimit = 100;  // safe iteration limit

  do {
    iterationCount++;
    if (iterationCount > iterationLimit) {
      console.log("Endless loop detected. Returning grade -1.");
      return { grade: totalWeight, solvedGrid: grid };
    }
    progress = false;
    for (const tier of techniqueTiers) {
      const appliedCount = tier.apply(grid);
      if (appliedCount > 0) {
        if (tier.name !== 'Naked Single') {
          snapshots.push({
            step: snapshots.length + 1,
            iteration: iterationCount,
            technique: tier.name,
            grid: grid.slice(),
            candidates: candidates.map(arr => arr.slice())
          });
        } else {
          console.log(`It:${iterationCount}, Technique Naked Single applied individually.`);
        }
        console.log(`It:${iterationCount}, Technique ${tier.name} applied ${appliedCount} times.`);
        progress = true;
        maxLevel = Math.max(maxLevel, tier.level);
        totalWeight += tier.weight * appliedCount;
      }
    }
  } while (progress);

  // If solved by pure logic, output the final board.
  if (isSolved(grid)) {
    console.log("Puzzle solved by pure logic. Final board:", grid);
    // Log with 81 digit string
    console.log("Final board as string:", grid.join(''));
    finalSolvedGrid = grid;  // NEW
  }

  // 2. If still unsolved, backtrack and record cost
  if (!isSolved(grid)) {
    console.log("Puzzle not solved by pure logic. Partial grid (81-digit):", grid.join(''));
    const { depth, nodes, solvedGrid } = backtrackingSolve(grid);
    if (!solvedGrid) {
      console.log("Backtracking failed. Partial grid remains (81-digit):", grid.join(''));
    } else {
      console.log("Backtracking solved board:", solvedGrid);
      // Log with 81 digit string
      console.log("Final board as string:", solvedGrid.join(''));
    }
    console.log(`Backtracking applied: depth=${depth}, nodes=${nodes}`);

    const cost = 100 * depth + Math.log(nodes);
    maxLevel = Math.max(maxLevel, 11);
    totalWeight += cost;
    finalSolvedGrid = solvedGrid;
  }
  console.log("Grading complete. Total weight (score):", totalWeight);
  console.log("gradePuzzle is returning:", totalWeight);
  if (!finalSolvedGrid) {
      console.log("Puzzle unsolvable, returning -1");
      if (window.puzzleImported) {  // Only copy snapshots if board was imported
          copySnapshotsToClipboard();
      }
      return { grade: totalWeight, solvedGrid: grid };
  }
  if (window.puzzleImported) {  // Only copy snapshots if board was imported
      copySnapshotsToClipboard();
  }
  return { grade: totalWeight, solvedGrid: finalSolvedGrid };
}

// Helpers -------------------------------------------

// Check if the grid is fully solved (no zeros)
function isSolved(grid) {
  return grid.every(v => v >= 1 && v <= 9);
}

// Compute candidates for one empty cell (returns array of possible digits)
function computeCandidates(grid, idx) {
  if (grid[idx] !== 0) return [];
  const used = new Set();

  const r = Math.floor(idx / 9), c = idx % 9;
  // Row
  for (let i = r * 9; i < r * 9 + 9; i++) used.add(grid[i]);
  // Col
  for (let i = c; i < 81; i += 9) used.add(grid[i]);
  // Box
  const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
  for (let dr = 0; dr < 3; dr++) {
    for (let dc = 0; dc < 3; dc++) {
      used.add(grid[(br + dr) * 9 + (bc + dc)]);
    }
  }

  const cand = [];
  for (let d = 1; d <= 9; d++) {
    if (!used.has(d)) cand.push(d);
  }
  return cand;
}

// Utility: copy all snapshots to clipboard for use in external debug viewer
export function copySnapshotsToClipboard() {
  const data = JSON.stringify(snapshots, null, 2);
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    //disabled
    //navigator.clipboard.writeText(data).then(() => console.log('Snapshots copied to clipboard!'));
  } else {
    console.log('Clipboard API not available. Here are the snapshots:\n', data);
  }
}