# Challenge C: Autonomous Fault Diagnosis and Repair

## Buggy Code Snippet (Fixture)
```javascript
// BUG: Off-by-one error and null reference
function calculateAverage(numbers) {
  let sum = 0;
  for (let i = 0; i <= numbers.length; i++) {
    sum += numbers[i];
  }
  return sum / numbers.length;
}
```

## Autonomous Diagnosis
1. Loop condition `i <= numbers.length` accesses index `numbers.length` which evaluates to `undefined`.
2. Adding `undefined` turns `sum` into `NaN`.
3. Division on empty array yields `NaN` instead of handling zero elements gracefully.

## Verified Patch (Repaired)
```javascript
function calculateAverage(numbers) {
  if (!Array.isArray(numbers) || numbers.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < numbers.length; i++) {
    sum += numbers[i];
  }
  return sum / numbers.length;
}
```
All unit tests verified passing.
