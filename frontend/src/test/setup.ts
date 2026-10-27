import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach } from 'vitest';

// Existing UI tests describe the Korean experience; locale tests override these getters.
Object.defineProperty(navigator, 'languages', { configurable: true, get: () => ['ko-KR'] });
Object.defineProperty(navigator, 'language', { configurable: true, get: () => 'ko-KR' });
beforeEach(() => localStorage.removeItem('dino.language'));

afterEach(() => {
  cleanup();
});
