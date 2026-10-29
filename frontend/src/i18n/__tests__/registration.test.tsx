import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AuthProvider } from '../../auth/AuthContext';
import { ToastProvider } from '../../components/ui';
import { RegisterPage } from '../../pages/Auth/RegisterPage';
import { SchoolEmailFields } from '../../pages/Auth/SchoolEmailFields';
import { setLanguage, t } from '..';

beforeEach(() => {
  localStorage.clear();
  setLanguage('en');
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ signup: { email_verification: false } }))));
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('shows English registration and validation and preserves input while switching language', async () => {
  const user = userEvent.setup();
  render(<MemoryRouter><ToastProvider><AuthProvider><RegisterPage /></AuthProvider></ToastProvider></MemoryRouter>);
  expect(await screen.findByRole('heading', { name: 'Register' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: /School email/ })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: /^Name/ })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: /Department/ })).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /I agree/ })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/login');
  expect(screen.getByText('Already registered?')).toBeInTheDocument();
  await user.type(screen.getByRole('textbox', { name: /Nickname/ }), 'Dino');
  await user.click(screen.getByRole('button', { name: 'Register' }));
  expect(screen.getByText('Enter your name.')).toBeInTheDocument();
  expect(screen.getByText('Enter your 10-digit student ID.')).toBeInTheDocument();
  expect(screen.getByText('Enter your school email address.')).toBeInTheDocument();
  act(() => setLanguage('ko'));
  expect(screen.getByRole('heading', { name: '참가 신청' })).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: /닉네임/ })).toHaveValue('Dino');
  expect(screen.getByText('이름을 입력해 주세요.')).toBeInTheDocument();
});

it('shows English verification-code controls and delivery feedback', async () => {
  const user = userEvent.setup();
  render(<SchoolEmailFields email="dino@g.skku.edu" onEmailChange={() => {}} code="" onCodeChange={() => {}} onEmailError={() => {}}
    send={async () => ({ email: 'd***@g.skku.edu', resend_after: 60, expires_in: 600 })} />);
  await user.click(screen.getByRole('button', { name: 'Send verification code' }));
  expect(await screen.findByText(/We sent a verification code to d\*\*\*@g.skku.edu/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Resend in 60 seconds' })).toBeDisabled();
  expect(screen.getByRole('textbox', { name: /Verification code/ })).toBeInTheDocument();
});

it.each([
  ['인증 코드가 없거나 만료되었습니다. 코드를 다시 받아 주세요.', 'The verification code is missing or expired. Request a new code.'],
  ['인증 코드를 너무 많이 틀렸습니다. 코드를 다시 받아 주세요.', 'Too many incorrect attempts. Request a new verification code.'],
  ['인증 코드가 맞지 않습니다. 4번 더 시도할 수 있습니다.', 'The verification code is incorrect. You have 4 attempts left.'],
  ['42초 뒤에 다시 요청할 수 있습니다.', 'You can request another code in 42 seconds.'],
])('translates verification failures: %s', (message, expected) => {
  expect(t(message)).toBe(expected);
});
