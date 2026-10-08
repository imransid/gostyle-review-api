import { DependencyUnavailableError } from '../../domain/ports/contact-directory.port';

/**
 * GET a JSON resource from another service.
 *
 *   200 -> the body
 *   404 -> null (the other service says it does not exist; an answer, not a fault)
 *   anything else, a timeout or a refused connection -> DependencyUnavailableError
 *
 * The URL is never put in an error: some paths carry ids a log should not
 * collect, and none of them are needed to know which dependency failed.
 */
export async function getJson<T>(
  dependency: string,
  url: string,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  } catch (e) {
    throw new DependencyUnavailableError(
      dependency,
      `${dependency} unreachable: ${e instanceof Error ? e.name : 'error'}`,
    );
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new DependencyUnavailableError(dependency, `${dependency} answered HTTP ${res.status}`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new DependencyUnavailableError(dependency, `${dependency} answered unreadable JSON`);
  }
}
