import { prepareTestDatabase } from '../support/local-db';

export default async function setup(): Promise<void> {
  await prepareTestDatabase();
}
