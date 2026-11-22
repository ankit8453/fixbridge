import { LegalPage } from '../components/LegalPage';

/**
 * `/delete-account` — how to have an account erased.
 *
 * There is no self-serve button: the request is checked by a person and then
 * carried out with `apps/api/scripts/delete-user.ts`. That script removes the
 * database rows only — uploaded files in storage have to be removed by hand.
 */
const SECTIONS = ['how', 'when', 'what', 'kept'] as const;

export default function DeleteAccount() {
  return <LegalPage ns="deleteAccount" pathname="/delete-account" sections={SECTIONS} />;
}
