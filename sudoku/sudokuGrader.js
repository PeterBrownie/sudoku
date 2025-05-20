// sudokuGrader.js
// Rebuilt to use modular strategy functions and a central solving engine

// -------------------- Helpers --------------------

/**
 * Parse an 81-character string into an array of numbers (0 = empty)
 */
function parsePuzzle(puzzleString) {
  if (puzzleString.length !== 81) {
    throw new Error('Puzzle string must be exactly 81 characters');
  }
  return Array.from(puzzleString, ch => parseInt(ch, 10));
}

/**
 * Compute possible candidates for a cell
 */
function computeCandidates(grid, idx) {
  if (grid[idx] !== 0) return [];
  const used = new Set();
  const r = Math.floor(idx / 9), c = idx % 9;
  // Row
  for (let j = r * 9; j < r * 9 + 9; j++) used.add(grid[j]);
  // Col
  for (let j = c; j < 81; j += 9) used.add(grid[j]);
  // Box
  const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
  for (let dr = 0; dr < 3; dr++) {
    for (let dc = 0; dc < 3; dc++) {
      used.add(grid[(br + dr) * 9 + (bc + dc)]);
    }
  }
  const result = [];
  for (let d = 1; d <= 9; d++) {
    if (!used.has(d)) result.push(d);
  }
  return result;
}

/**
 * Initialize candidate lists for all cells
 */
function initCandidates(grid) {
  return grid.map((v, i) => (v === 0 ? computeCandidates(grid, i) : []));
}

/**
 * Check if the grid is completely solved
 */
function isSolved(grid) {
  return grid.every(v => v >= 1 && v <= 9);
}

/**
 * Check if inserting `num` at `idx` is valid under Sudoku rules
 */
function isValidCell(grid, idx, num) {
  const r = Math.floor(idx / 9), c = idx % 9;
  // Row
  for (let j = r * 9; j < r * 9 + 9; j++) if (grid[j] === num) return false;
  // Col
  for (let j = c; j < 81; j += 9) if (grid[j] === num) return false;
  // Box
  const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
  for (let dr = 0; dr < 3; dr++) for (let dc = 0; dc < 3; dc++) {
    if (grid[(br + dr) * 9 + (bc + dc)] === num) return false;
  }
  return true;
}

/**
 * Remove a value from peers of a filled cell
 */
function updatePeers(grid, candidates, idx, value) {
  const r = Math.floor(idx / 9), c = idx % 9;
  // Row & Col & Box eliminations
  for (let j = r * 9; j < r * 9 + 9; j++) {
    if (grid[j] === 0) candidates[j] = candidates[j].filter(x => x !== value);
  }
  for (let j = c; j < 81; j += 9) {
    if (grid[j] === 0) candidates[j] = candidates[j].filter(x => x !== value);
  }
  const br = Math.floor(r / 3) * 3, bc = Math.floor(c / 3) * 3;
  for (let dr = 0; dr < 3; dr++) {
    for (let dc = 0; dc < 3; dc++) {
      const peer = (br + dr) * 9 + (bc + dc);
      if (grid[peer] === 0) candidates[peer] = candidates[peer].filter(x => x !== value);
    }
  }
}

// -------------------- Strategy Functions --------------------

/**
 * Naked Single strategy: fill any cell with exactly one candidate.
 */
function nakedSingleStrategy(grid, candidates) {
  const newGrid = grid.slice();
  const newCands = candidates.map(arr => arr.slice());
  for (let i = 0; i < 81; i++) {
    if (newGrid[i] === 0 && newCands[i].length === 1) {
      const val = newCands[i][0];
      if (!isValidCell(newGrid, i, val)) break;
      newGrid[i] = val;
      newCands[i] = [];
      updatePeers(newGrid, newCands, i, val);
      return { newGrid, newCands, progressed: true };
    }
  }
  return { newGrid: grid, newCands: candidates, progressed: false };
}

/**
 * Hidden Single strategy: fill a cell when a candidate appears exactly once in a unit.
 */
function hiddenSingleStrategy(grid, candidates) {
  const newGrid = grid.slice();
  const newCands = candidates.map(arr => arr.slice());
  function processUnit(unit) {
    for (let d = 1; d <= 9; d++) {
      const pos = unit.filter(i => newGrid[i] === 0 && newCands[i].includes(d));
      if (pos.length === 1 && isValidCell(newGrid, pos[0], d)) {
        newGrid[pos[0]] = d;
        newCands[pos[0]] = [];
        updatePeers(newGrid, newCands, pos[0], d);
        return true;
      }
    }
    return false;
  }
  // rows
  for (let r = 0; r < 9; r++) {
    const unit = Array.from({ length: 9 }, (_, k) => r * 9 + k);
    if (processUnit(unit)) return { newGrid, newCands, progressed: true };
  }
  // cols
  for (let c = 0; c < 9; c++) {
    const unit = Array.from({ length: 9 }, (_, k) => c + 9 * k);
    if (processUnit(unit)) return { newGrid, newCands, progressed: true };
  }
  // boxes
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const unit = [];
      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) {
          unit.push((br * 3 + dr) * 9 + (bc * 3 + dc));
        }
      }
      if (processUnit(unit)) return { newGrid, newCands, progressed: true };
    }
  }
  return { newGrid: grid, newCands: candidates, progressed: false };
}

/**
 * Locked Candidate strategy: eliminate candidate d from peers 
 * based on box confinement.
 */
function lockedCandidateStrategy(grid, candidates) {
  const newGrid = grid.slice();
  const newCands = candidates.map(arr => arr.slice());
  let progressed = false;
  // iterate each 3×3 box
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const boxIdxs = [];
      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) {
          const idx = (3 * br + dr) * 9 + (3 * bc + dc);
          if (newGrid[idx] === 0) boxIdxs.push(idx);
        }
      }
      for (let d = 1; d <= 9; d++) {
        const pos = boxIdxs.filter(i => computeCandidates(newGrid, i).includes(d));
        if (pos.length >= 2) {
          const rows = new Set(pos.map(i => Math.floor(i / 9)));
          if (rows.size === 1) {
            const r = [...rows][0];
            for (let j = r * 9; j < r * 9 + 9; j++) {
              if (!boxIdxs.includes(j) && newGrid[j] === 0 && newCands[j].includes(d)) {
                newCands[j] = newCands[j].filter(x => x !== d);
                progressed = true;
              }
            }
          }
          const cols = new Set(pos.map(i => i % 9));
          if (cols.size === 1) {
            const c = [...cols][0];
            for (let j = c; j < 81; j += 9) {
              if (!boxIdxs.includes(j) && newGrid[j] === 0 && newCands[j].includes(d)) {
                newCands[j] = newCands[j].filter(x => x !== d);
                progressed = true;
              }
            }
          }
        }
      }
    }
  }
  return { newGrid, newCands, progressed };
}

/**
 * Pointing Pair strategy: if candidates in a box are confined to one row/column,
 * eliminate them from the rest of that row/column.
 */
function pointingPairStrategy(grid, candidates) {
  const newGrid = grid.slice();
  const newCands = candidates.map(arr => arr.slice());
  let progressed = false;
  let highlight = {}; // new mapping for highlighting pointing pair candidate cells
  for (let br = 0; br < 3; br++) {
    for (let bc = 0; bc < 3; bc++) {
      const boxIdxs = [];
      for (let dr = 0; dr < 3; dr++) {
        for (let dc = 0; dc < 3; dc++) {
          const idx = (3 * br + dr) * 9 + (3 * bc + dc);
          if (newGrid[idx] === 0) boxIdxs.push(idx);
        }
      }
      for (let d = 1; d <= 9; d++) {
        const pos = boxIdxs.filter(i => newCands[i].includes(d));
        const rows = new Set(pos.map(i => Math.floor(i / 9)));
        if (pos.length >= 2 && rows.size === 1) {
          // Highlight the pair cells used as support
          pos.forEach(i => {
            highlight[i] = { bgColor: 'lightblue', textColor: 'black' };
          });
          const r = [...rows][0];
          for (let j = r * 9; j < r * 9 + 9; j++) {
            if (!boxIdxs.includes(j) && newGrid[j] === 0 && newCands[j].includes(d)) {
              newCands[j] = newCands[j].filter(x => x !== d);
              progressed = true;
            }
          }
        }
        const cols = new Set(pos.map(i => i % 9));
        if (pos.length >= 2 && cols.size === 1) {
          // Highlight the pair cells used as support
          pos.forEach(i => {
            highlight[i] = { bgColor: 'lightblue', textColor: 'black' };
          });
          const c = [...cols][0];
          for (let j = c; j < 81; j += 9) {
            if (!boxIdxs.includes(j) && newGrid[j] === 0 && newCands[j].includes(d)) {
              newCands[j] = newCands[j].filter(x => x !== d);
              progressed = true;
            }
          }
        }
      }
    }
  }
  return { newGrid, newCands, progressed, highlight };
}

/**
 * Box/Line Reduction strategy: eliminate candidate d from a box if
 * d is confined to one row/column within that box.
 */
function boxLineReductionStrategy(grid, candidates) {
  const newGrid = grid.slice();
  const newCands = candidates.map(arr => arr.slice());
  let progressed = false;
  // Row-based reductions
  for (let d = 1; d <= 9; d++) {
    for (let r = 0; r < 9; r++) {
      const rowCells = Array.from({ length: 9 }, (_, k) => r * 9 + k)
        .filter(i => newGrid[i] === 0 && newCands[i].includes(d));
      if (rowCells.length > 1) {
        const boxRow = Math.floor(rowCells[0] / 27);
        const boxCol = Math.floor((rowCells[0] % 9) / 3);
        if (rowCells.every(i => Math.floor(i / 27) === boxRow && Math.floor((i % 9) / 3) === boxCol)) {
          for (let dr = 0; dr < 3; dr++) {
            for (let dc = 0; dc < 3; dc++) {
              const idx = (boxRow * 3 + dr) * 9 + (boxCol * 3 + dc);
              if (newGrid[idx] === 0 && !rowCells.includes(idx) && newCands[idx].includes(d)) {
                newCands[idx] = newCands[idx].filter(x => x !== d);
                progressed = true;
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
        .filter(i => newGrid[i] === 0 && newCands[i].includes(d));
      if (colCells.length > 1) {
        const boxRow = Math.floor(colCells[0] / 27);
        const boxCol = Math.floor((colCells[0] % 9) / 3);
        if (colCells.every(i => Math.floor(i / 27) === boxRow && Math.floor((i % 9) / 3) === boxCol)) {
          for (let dr = 0; dr < 3; dr++) {
            for (let dc = 0; dc < 3; dc++) {
              const idx = (boxRow * 3 + dr) * 9 + (boxCol * 3 + dc);
              if (newGrid[idx] === 0 && !colCells.includes(idx) && newCands[idx].includes(d)) {
                newCands[idx] = newCands[idx].filter(x => x !== d);
                progressed = true;
              }
            }
          }
        }
      }
    }
  }
  return { newGrid, newCands, progressed };
}

/**
 * Naked Pair strategy: in a unit if exactly two cells share 
 * the same two candidates, remove those candidates from the rest.
 */
function nakedPairStrategy(grid, candidates) {
	const newGrid = grid.slice();
	const newCands = candidates.map(arr => arr.slice());
	let progressed = false;
	let highlight = {}; // mapping for highlighting naked pair cells
	const units = [];
	// Rows
	for (let r = 0; r < 9; r++) {
		units.push(Array.from({ length: 9 }, (_, k) => r * 9 + k));
	}
	// Columns
	for (let c = 0; c < 9; c++) {
		units.push(Array.from({ length: 9 }, (_, k) => c + 9 * k));
	}
	// Boxes
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
	// Process each unit until one naked pair is applied
	outer:
	for (const unit of units) {
		const pairCells = unit.filter(i => newGrid[i] === 0 && newCands[i].length === 2);
		const seen = {};
		for (const i of pairCells) {
			const key = newCands[i].slice().sort().join(',');
			seen[key] = seen[key] || [];
			seen[key].push(i);
		}
		for (const key in seen) {
			if (seen[key].length === 2) {
				const nums = key.split(',').map(Number);
				let unitProgress = false;
				for (const i of unit) {
					if (!seen[key].includes(i) && newGrid[i] === 0) {
						const before = newCands[i].length;
						newCands[i] = newCands[i].filter(x => !nums.includes(x));
						if (newCands[i].length < before) {
							unitProgress = true;
						}
					}
				}
				if (unitProgress) {
					// Only highlight the naked pair used for elimination in this unit
					for (const i of seen[key]) {
						highlight[i] = { bgColor: 'yellow', textColor: 'black' };
					}
					progressed = true;
					break outer;
				}
			}
		}
	}
	return { newGrid, newCands, progressed, highlight };
}

/**
 * Naked Triple strategy: in a unit, if three cells collectively
 * have exactly three candidates, remove those from other cells.
 */
function nakedTripleStrategy(grid, candidates) {
  const newGrid = grid.slice();
  const newCands = candidates.map(arr => arr.slice());
  let progressed = false;
  const units = [];
  // Rows
  for (let r = 0; r < 9; r++) units.push(Array.from({ length: 9 }, (_, k) => r * 9 + k));
  // Columns
  for (let c = 0; c < 9; c++) units.push(Array.from({ length: 9 }, (_, k) => c + 9 * k));
  // Boxes
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
  units.forEach(unit => {
    const unsolved = unit.filter(i => newGrid[i] === 0);
    for (let a = 0; a < unsolved.length - 2; a++) {
      for (let b = a + 1; b < unsolved.length - 1; b++) {
        for (let c = b + 1; c < unsolved.length; c++) {
          const i = unsolved[a], j = unsolved[b], k = unsolved[c];
          const candA = newCands[i], candB = newCands[j], candC = newCands[k];
          const unionSet = new Set([...candA, ...candB, ...candC]);
          if (unionSet.size === 3 &&
              candA.every(d => unionSet.has(d)) &&
              candB.every(d => unionSet.has(d)) &&
              candC.every(d => unionSet.has(d))) {
            unit.forEach(idx => {
              if (idx !== i && idx !== j && idx !== k && newGrid[idx] === 0) {
                const before = newCands[idx].length;
                newCands[idx] = newCands[idx].filter(d => !unionSet.has(d));
                if (newCands[idx].length < before) progressed = true;
              }
            });
          }
        }
      }
    }
  });
  return { newGrid, newCands, progressed };
}

/**
 * X-Wing strategy: find matching candidate pairs in two rows and eliminate 
 * the candidate from other rows in the same columns.
 */
function xWingStrategy(grid, candidates) {
  const newGrid = grid.slice();
  const newCands = candidates.map(arr => arr.slice());
  let progressed = false;
  const seenXWings = new Set();
  for (let d = 1; d <= 9; d++) {
    const rowPositions = Array.from({ length: 9 }, () => []);
    for (let r = 0; r < 9; r++) {
      for (let c = 0; c < 9; c++) {
        const idx = r * 9 + c;
        if (newGrid[idx] === 0 && newCands[idx].includes(d)) {
          rowPositions[r].push(c);
        }
      }
    }
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
          for (let r3 = 0; r3 < 9; r3++) {
            if (r3 === r1 || r3 === r2) continue;
            [c1, c2].forEach(c => {
              const idx = r3 * 9 + c;
              if (newGrid[idx] === 0 && newCands[idx].includes(d)) {
                newCands[idx] = newCands[idx].filter(x => x !== d);
                progressed = true;
              }
            });
          }
        }
      }
    }
  }
  return { newGrid, newCands, progressed };
}

/**
 * Unique Rectangle strategy: detect a nearly bi-value rectangle and eliminate extra candidates.
 */
function uniqueRectangleStrategy(grid, candidates) {
  const newGrid = grid.slice();
  const newCands = candidates.map(arr => arr.slice());
  let progressed = false;
  for (let r1 = 0; r1 < 8; r1++) {
    for (let r2 = r1 + 1; r2 < 9; r2++) {
      for (let c1 = 0; c1 < 8; c1++) {
        for (let c2 = c1 + 1; c2 < 9; c2++) {
          const idxs = [r1 * 9 + c1, r1 * 9 + c2, r2 * 9 + c1, r2 * 9 + c2];
          if (idxs.every(i => newGrid[i] === 0)) {
            const lists = idxs.map(i => newCands[i]);
            if (lists.filter(l => l.length === 2 &&
                  l.slice().sort().join(',') === lists[0].slice().sort().join(',')).length === 3) {
              const common = lists[0].slice().sort((a, b) => a - b);
              const extraIdx = idxs.find(i => newCands[i].length > 2 && common.every(d => newCands[i].includes(d)));
              if (extraIdx !== undefined) {
                const before = newCands[extraIdx].length;
                newCands[extraIdx] = newCands[extraIdx].filter(d => common.includes(d));
                if (newCands[extraIdx].length < before) progressed = true;
              }
            }
          }
        }
      }
    }
  }
  return { newGrid, newCands, progressed };
}

/**
 * Simple Coloring Rule 2 strategy: eliminate all candidates in a color group if two same-colored nodes share a unit.
 */
function simpleColorRule2Strategy(grid, candidates) {
  const newGrid = grid.slice();
  const newCands = candidates.map(arr => arr.slice());
  let progressed = false;
  let highlight = {}; // map to mark each color group with a distinct color
  function sharesUnit(i, j) {
    if (Math.floor(i / 9) === Math.floor(j / 9)) return true;
    if (i % 9 === j % 9) return true;
    const br1 = Math.floor(i / 27), bc1 = Math.floor((i % 9) / 3);
    const br2 = Math.floor(j / 27), bc2 = Math.floor((j % 9) / 3);
    return br1 === br2 && bc1 === bc2;
  }
  for (let d = 1; d <= 9; d++) {
    const candPos = [];
    for (let idx = 0; idx < 81; idx++) {
      if (newGrid[idx] === 0 && newCands[idx].includes(d)) {
        candPos.push(idx);
      }
    }
    if (candPos.length === 0) continue;
    const links = {};
    candPos.forEach(idx => { links[idx] = []; });
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
    const visited = new Set();
    for (const start of candPos) {
      if (visited.has(start)) continue;
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
      // Color the two groups distinctly
      compA.forEach(i => { highlight[i] = { bgColor: 'lightgreen', textColor: 'black' }; });
      compB.forEach(i => { highlight[i] = { bgColor: 'lightpink', textColor: 'black' }; });
      // Rule 2 elimination as in existing code...
      for (const group of [compA, compB]) {
        let eliminated = false;
        for (let i = 0; i < group.length - 1 && !eliminated; i++) {
          for (let j = i + 1; j < group.length; j++) {
            if (sharesUnit(group[i], group[j])) {
              group.forEach(idx => {
                if (newCands[idx].includes(d)) {
                  newCands[idx] = newCands[idx].filter(x => x !== d);
                  progressed = true;
                }
              });
              eliminated = true;
              break;
            }
          }
        }
      }
    }
  }
  return { newGrid, newCands, progressed, highlight };
}

/**
 * Simple Coloring Rule 4 strategy: For each candidate d, if a cell not in either color group sees both colors, eliminate d from that cell.
 */
function simpleColorRule4Strategy(grid, candidates) {
  const newGrid = grid.slice();
  const newCands = candidates.map(arr => arr.slice());
  let progressed = false;
  let highlight = {}; // new mapping for simple coloring rule 4
  function sharesUnit(i, j) {
    if (Math.floor(i / 9) === Math.floor(j / 9)) return true;
    if (i % 9 === j % 9) return true;
    const br1 = Math.floor(i / 27), bc1 = Math.floor((i % 9) / 3);
    const br2 = Math.floor(j / 27), bc2 = Math.floor((j % 9) / 3);
    return br1 === br2 && bc1 === bc2;
  }
  for (let d = 1; d <= 9; d++) {
    const candPos = [];
    for (let idx = 0; idx < 81; idx++) {
      if (newGrid[idx] === 0 && newCands[idx].includes(d)) {
        candPos.push(idx);
      }
    }
    if (candPos.length === 0) continue;
    const links = {};
    candPos.forEach(idx => { links[idx] = []; });
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
    const visited = new Set();
    for (const start of candPos) {
      if (visited.has(start)) continue;
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
      // Highlight groups with different colors (blue and orange)
      compA.forEach(i => { highlight[i] = { bgColor: 'lightblue', textColor: 'black' }; });
      compB.forEach(i => { highlight[i] = { bgColor: 'orange', textColor: 'black' }; });
      // Rule 4 elimination as in existing code...
      for (let idx = 0; idx < 81; idx++) {
        if (newGrid[idx] !== 0) continue;
        if (!newCands[idx].includes(d)) continue;
        if (compA.includes(idx) || compB.includes(idx)) continue;
        let seesA = false, seesB = false;
        for (const a of compA) {
          if (sharesUnit(idx, a)) { seesA = true; break; }
        }
        for (const b of compB) {
          if (sharesUnit(idx, b)) { seesB = true; break; }
        }
        if (seesA && seesB) {
          newCands[idx] = newCands[idx].filter(x => x !== d);
          progressed = true;
        }
      }
    }
  }
  return { newGrid, newCands, progressed, highlight };
}

/**
 * Chute Remote Pairs strategy: find two bi-value cells with the same pair
 * in the same chute (three-box row or column), remote (not in same unit),
 * then use the unused box in that chute to eliminate a candidate from
 * cells seen by both.
 */
function chuteRemotePairsStrategy(grid, candidates) {
  const newGrid = grid.slice();
  const newCands = candidates.map(arr => arr.slice());
  let progressed = false;

  // generate chutes with box coordinates
  const chutes = [];
  // horizontal chutes (boxRow 0,1,2)
  for (let boxRow = 0; boxRow < 3; boxRow++) {
    const cells = [];
    for (let r = boxRow * 3; r < boxRow * 3 + 3; r++) {
      for (let c = 0; c < 9; c++) {
        cells.push(r * 9 + c);
      }
    }
    chutes.push({ cells, boxRow, boxCol: null });
  }
  // vertical chutes (boxCol 0,1,2)
  for (let boxCol = 0; boxCol < 3; boxCol++) {
    const cells = [];
    for (let r = 0; r < 9; r++) {
      for (let c = boxCol * 3; c < boxCol * 3 + 3; c++) {
        cells.push(r * 9 + c);
      }
    }
    chutes.push({ cells, boxRow: null, boxCol });
  }

  // helper to check if two indices share a unit
  function sharesUnit(i, j) {
    if (Math.floor(i / 9) === Math.floor(j / 9)) return true;
    if (i % 9 === j % 9) return true;
    const br1 = Math.floor(i / 27), bc1 = Math.floor((i % 9) / 3);
    const br2 = Math.floor(j / 27), bc2 = Math.floor((j % 9) / 3);
    return br1 === br2 && bc1 === bc2;
  }

  for (const { cells, boxRow, boxCol } of chutes) {
    // find all bi-value cells in this chute
    const bivals = cells.filter(i => newGrid[i] === 0 && newCands[i].length === 2);
    for (let a = 0; a < bivals.length - 1; a++) {
      for (let b = a + 1; b < bivals.length; b++) {
        const i = bivals[a], j = bivals[b];
        const pair1 = newCands[i].slice().sort();
        const pair2 = newCands[j].slice().sort();
        // same remote pair?
        if (pair1[0] !== pair2[0] || pair1[1] !== pair2[1]) continue;
        // ensure remote (not same row, col, or box)
        if (sharesUnit(i, j)) continue;
        const [d1, d2] = pair1;
        // determine the unused box in this chute
        const boxes = [];
        if (boxRow !== null) {
          // horizontal chute: boxes in this band
          for (let bc = 0; bc < 3; bc++) boxes.push({ br: boxRow, bc });
        } else {
          // vertical chute: boxes in this stack
          for (let br = 0; br < 3; br++) boxes.push({ br, bc: boxCol });
        }
        // find boxes containing i and j
        const boxOf = idx => ({ br: Math.floor(idx / 27), bc: Math.floor((idx % 9) / 3) });
        const usedCoords = [boxOf(i), boxOf(j)].map(o => `${o.br},${o.bc}`);
        const unused = boxes.find(({ br, bc }) => !usedCoords.includes(`${br},${bc}`));
        // gather yellow cells in the unused box
        const yellow = [];
        for (let dr = 0; dr < 3; dr++) {
          for (let dc = 0; dc < 3; dc++) {
            yellow.push((unused.br * 3 + dr) * 9 + (unused.bc * 3 + dc));
          }
        }
        // check presence of each candidate in yellow cells (including solved/clue cells)
        const present = [];
        if (yellow.some(idx => newGrid[idx] === d1 || computeCandidates(newGrid, idx).includes(d1))) present.push(d1);
        if (yellow.some(idx => newGrid[idx] === d2 || computeCandidates(newGrid, idx).includes(d2))) present.push(d2);
        // if exactly one candidate is present, eliminate it from all cells seen by both i and j
        if (present.length === 1) {
          const elim = present[0];
          for (let idx = 0; idx < 81; idx++) {
            if (newGrid[idx] === 0 &&
                newCands[idx].includes(elim) &&
                sharesUnit(idx, i) &&
                sharesUnit(idx, j)) {
              newCands[idx] = newCands[idx].filter(x => x !== elim);
              progressed = true;
            }
          }
        }
      }
    }
  }

  return { newGrid, newCands, progressed };
}

// -------------------- Strategy Registry --------------------
const strategies = [
  { name: 'Solved Cell', weight: 0.1, fn: nakedSingleStrategy },
  { name: 'Naked Pair', weight: 2, fn: nakedPairStrategy },
  { name: 'Naked Triple', weight: 3, fn: nakedTripleStrategy },
  { name: 'Hidden Single', weight: 1, fn: hiddenSingleStrategy },
  // TODO: Naked/Hidden Quad
  { name: 'Locked Candidate', weight: 1, fn: lockedCandidateStrategy },
  { name: 'Pointing Pair', weight: 1, fn: pointingPairStrategy },
  { name: 'Box/Line Reduction', weight: 2, fn: boxLineReductionStrategy },

  { name: 'X-Wing', weight: 5, fn: xWingStrategy },
  { name: 'Chute Remote Pairs', weight: 4, fn: chuteRemotePairsStrategy },
  { name: 'Simple Coloring Rule 2', weight: 4, fn: simpleColorRule2Strategy },
  { name: 'Simple Coloring Rule 4', weight: 4, fn: simpleColorRule4Strategy },
  // TODO: Y-Wing
  { name: 'Unique Rectangle', weight: 3, fn: uniqueRectangleStrategy }
];

// Updated: Global snapshot tracking
let snapshots = [];
let snapshotCounter = 1;
window.snapshots = snapshots;

function pushSnapshot(technique, grid, candidates, highlight = {}) {
  const snapshotHighlight = JSON.parse(JSON.stringify(highlight)); // deep clone
  snapshots.push({
    step: snapshotCounter++,
    technique, 
    grid: grid.slice(), 
    candidates: candidates.map(arr => arr.slice()),
    highlight: snapshotHighlight
  });
}

// -------------------- Main Solving Engine --------------------
/**
 * gradePuzzle: attempts to solve using logic strategies
 * returns { grade, solved, solvedPuzzle }
 */
export function gradePuzzle(puzzleString) {
  let grid = parsePuzzle(puzzleString);
  let candidates = initCandidates(grid);
  // Reset snapshots on each run
  snapshots = [];
  snapshotCounter = 1;
  window.snapshots = snapshots;
  
  let usage = Object.fromEntries(strategies.map(s => [s.name, 0]));
  let idx = 0;
  let currentStrat = null;
  let currentCount = 0;

  while (idx < strategies.length && !isSolved(grid)) {
    const strat = strategies[idx];
    const result = strat.fn(grid, candidates);
    const { newGrid, newCands, progressed, highlight = {} } = result; // new highlight field
    if (progressed) {
      pushSnapshot(strat.name, newGrid, newCands, highlight); // pass highlight mapping
      if (currentStrat === strat.name) {
        currentCount++;
      } else {
        if (currentStrat) console.log(`${currentCount} time(s): ${currentStrat}`);
        currentStrat = strat.name;
        currentCount = 1;
      }
      grid = newGrid;
      candidates = newCands;
      usage[strat.name]++;
      idx = 0; // restart at first strategy
    } else {
      idx++;
    }
  }
  
  // Flush final strategy usage log
  if (currentCount > 0) console.log(`${currentCount} time(s): ${currentStrat}`);

  // Compute final score from logic strategies
  let grade = strategies.reduce((sum, s) => sum + usage[s.name] * s.weight, 0);

  // If puzzle remains unsolved, try backtracking as last resort.
  if (!isSolved(grid)) {
    console.log("No further progress; invoking backtracking strategy...");
    const { newGrid, depth, nodes, solved } = backtrackingStrategy(grid);
    if (solved) {
      grid = newGrid;
      pushSnapshot("Backtracking", grid, candidates, {}); // pass an empty highlight mapping
      const backtrackingCost = 100 * depth + Math.log(nodes);
      console.log("Backtracking solved the puzzle; cost:", backtrackingCost);
      grade += backtrackingCost;
      return { grade, solved: true, solvedPuzzle: grid.slice() };
    } else {
      console.log("Backtracking failed to solve the puzzle.");
      return { grade: 1000000, solved: false };
    }
  }
  
  if (isSolved(grid)) {
    console.log('Score:', strategies.reduce((sum, s) => sum + usage[s.name] * s.weight, 0));
    return { grade: strategies.reduce((sum, s) => sum + usage[s.name] * s.weight, 0), solved: true, solvedPuzzle: grid.slice() };
  } else {
    return { grade: strategies.reduce((sum, s) => sum + usage[s.name] * s.weight, 0), solved: false };
  }
}

/**
 * Backtracking strategy: perform a DFS search to solve the puzzle.
 * Returns an object { newGrid, depth, nodes, solved }.
 */
function backtrackingStrategy(startGrid) {
  const grid = startGrid.slice(); // copy
  let nodes = 0, maxDepth = 0;
  let solvedGrid = null;

  function dfs(depth = 1) {
    nodes++;
    maxDepth = Math.max(maxDepth, depth);
    const idx = grid.findIndex(v => v === 0);
    if (idx === -1) {
      solvedGrid = grid.slice();
      return true;
    }
    const cand = computeCandidates(grid, idx);
    for (const d of cand) {
      grid[idx] = d;
      if (dfs(depth + 1)) return true;
    }
    grid[idx] = 0;
    return false;
  }
  const solved = dfs();
  return { newGrid: solvedGrid, depth: maxDepth, nodes, solved };
}
