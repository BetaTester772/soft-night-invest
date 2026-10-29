import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BoothApp } from '../../booth/BoothApp';
import { boothState, config } from '../../booth/__tests__/fixtures';
import { won, time } from '../../booth/format';
import { localizeBoothState } from '../../booth/localize';
import { getLanguage, setLanguage, t } from '..';
import { detectLanguage, LANGUAGE_KEY } from '../locale';

beforeEach(() => {
  setLanguage('en');
  localStorage.clear();
  vi.spyOn(navigator, 'languages', 'get').mockReturnValue(['en-US']);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(boothState()))));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function page(path = '/') {
  return render(<MemoryRouter initialEntries={[path]}><BoothApp config={config} /></MemoryRouter>);
}

describe('language preferences', () => {
  it.each([
    [['ko-KR', 'en-US'], 'ko'],
    [['en-GB', 'ko-KR'], 'en'],
    [['fr-FR', 'ko'], 'ko'],
    [['KO_kr'], 'ko'],
    [['ja-JP'], 'en'],
    [[], 'en'],
  ] as const)('resolves %j to %s', (languages, expected) => {
    expect(detectLanguage(languages)).toBe(expected);
  });

  it('falls back to navigator.language when the preference list is empty', () => {
    vi.spyOn(navigator, 'languages', 'get').mockReturnValue([]);
    vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB');
    expect(getLanguage()).toBe('en');
  });

  it('uses a saved preference before browser language and ignores invalid preferences', () => {
    localStorage.setItem(LANGUAGE_KEY, 'ko');
    expect(getLanguage()).toBe('ko');
    localStorage.setItem(LANGUAGE_KEY, 'fr');
    expect(getLanguage()).toBe('en');
  });

  it('keeps a selection when storage writes are blocked', async () => {
    const user = userEvent.setup();
    page();
    await screen.findByRole('heading', { name: 'Dinosaur stock market' });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    await user.click(screen.getByRole('button', { name: '한국어' }));
    expect(getLanguage()).toBe('ko');
    expect(await screen.findByRole('heading', { name: '공룡 증시' })).toBeInTheDocument();
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage blocked'); });
    expect(getLanguage()).toBe('ko');
  });

  it('updates the UI when preferences change in another tab or in the browser', async () => {
    page();
    await screen.findByRole('heading', { name: 'Dinosaur stock market' });
    act(() => {
      localStorage.setItem(LANGUAGE_KEY, 'ko');
      window.dispatchEvent(new StorageEvent('storage', { key: LANGUAGE_KEY, storageArea: localStorage }));
    });
    expect(screen.getByRole('heading', { name: '공룡 증시' })).toBeInTheDocument();
    act(() => {
      localStorage.removeItem(LANGUAGE_KEY);
      window.dispatchEvent(new Event('languagechange'));
    });
    expect(screen.getByRole('heading', { name: 'Dinosaur stock market' })).toBeInTheDocument();
  });
});

it('defaults to English, persists switches, and updates content, currency, and document language', async () => {
  const user = userEvent.setup();
  const first = page();
  expect(await screen.findByRole('heading', { name: 'Dinosaur stock market' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getAllByText('Jurassic Feed').length).toBeGreaterThan(0);
  expect(screen.getAllByText('KRW 1,000,000').length).toBeGreaterThan(0);
  expect(document.documentElement.lang).toBe('en');
  expect(document.title).toBe('I Thought It Was a Meteor');
  await user.click(screen.getByRole('button', { name: '한국어' }));
  expect(screen.getByRole('heading', { name: '공룡 증시' })).toBeInTheDocument();
  expect(screen.getAllByText('쥐라기 사료').length).toBeGreaterThan(0);
  expect(screen.getAllByText('1,000,000원').length).toBeGreaterThan(0);
  expect(localStorage.getItem(LANGUAGE_KEY)).toBe('ko');
  expect(document.documentElement.lang).toBe('ko');
  first.unmount();
  page();
  expect(await screen.findByRole('heading', { name: '공룡 증시' })).toBeInTheDocument();
});

it('keeps an open order and its input when switching language, including existing server errors', async () => {
  const user = userEvent.setup();
  vi.stubGlobal('fetch', vi.fn(async (url: string) => url.includes('/orders')
    ? new Response(JSON.stringify({ detail: { code: 'INSUFFICIENT_CASH', message: '현금 잔고가 부족합니다.' } }), { status: 409 })
    : new Response(JSON.stringify(boothState()))));
  page('/funds');
  await user.click(await screen.findByRole('button', { name: 'Invest in this fund' }));
  const dialog = screen.getByRole('dialog');
  const input = within(dialog).getByRole('textbox', { name: /Investment amount/ });
  await user.clear(input);
  await user.type(input, '12345');
  await user.click(within(dialog).getByRole('button', { name: 'Buy fund' }));
  expect(await within(dialog).findByText('Insufficient cash balance.')).toBeInTheDocument();
  // The selector is outside the modal's focus trap; simulate a preference change from another tab.
  act(() => setLanguage('ko'));
  expect(within(dialog).getByRole('textbox', { name: /투자할 금액/ })).toHaveValue('12345');
  expect(within(dialog).getByText('현금 잔고가 부족합니다.')).toBeInTheDocument();
  expect(within(dialog).getByRole('button', { name: '닫기' })).toBeInTheDocument();
});

it('translates generated market content while preserving names and operator-authored news', () => {
  const data = boothState();
  const localized = localizeBoothState({ ...data, result: null, events: [
    { id: 1, kind: 'ghost', headline: '공룡 귀신 출몰! 사료·바이오 섹터 급등', sector: 'feed', rates: {}, created_at: data.now },
    { id: 2, kind: 'manual', headline: '현장 안내: 곧 시작합니다', sector: null, rates: {}, created_at: data.now },
  ] });
  expect(localized.events[0]?.headline).toBe('Dinosaur ghost sighting! Feed & biotech stocks surge.');
  expect(localized.events[1]?.headline).toBe('현장 안내: 곧 시작합니다');
  expect(localized.me?.nickname).toBe('김공룡');
  expect(data.instruments[0]?.name).toBe('쥐라기 사료');
  expect(t('시세 계산이 90초 이상 지연되었습니다.')).toContain('90 seconds');
  expect(won(12345)).toBe('KRW 12,345');
  expect(time('2026-10-30T07:00:00Z')).toBe('16:00');
});

it('offers the selector on the broadcast and admin screens', async () => {
  const first = page('/broadcast');
  expect(await screen.findByRole('heading', { name: 'Live from the dinosaur market.' })).toBeInTheDocument();
  expect(screen.getByRole('group', { name: 'Choose language' })).toBeInTheDocument();
  first.unmount();
  page('/admin');
  await waitFor(() => expect(screen.getByRole('heading', { name: 'Exchange administration' })).toBeInTheDocument());
  expect(screen.getByRole('group', { name: 'Choose language' })).toBeInTheDocument();
});

it('shows the dinner break and automatically generated English market headlines', async () => {
  const original = boothState();
  const data = { ...original, events: [{ id: 9, kind: 'market', headline: '초식공룡 식탁에 초록불… 사료·바이오 주가 상승', sector: 'feed', rates: {}, created_at: original.now }] };
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(data))));
  page();
  expect(await screen.findByText('Dinner break · 17:50–18:30 (KST)')).toBeInTheDocument();
  expect(screen.getAllByText('Green lights at the herbivore table: feed & biotech stocks rise.').length).toBeGreaterThan(0);
  expect(screen.getByRole('button', { name: /Jurassic.*18:30.*19:20/ })).toBeInTheDocument();
});
