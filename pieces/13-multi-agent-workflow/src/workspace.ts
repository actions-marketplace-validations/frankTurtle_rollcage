/** The files the agents work on. In-memory, so tests and the demo never touch a real repository. */
export class Workspace {
  private readonly files: Map<string, string>;
  private readonly written = new Set<string>();

  private constructor(files: Map<string, string>) {
    this.files = files;
  }

  static fromFiles(files: Record<string, string>): Workspace {
    return new Workspace(new Map(Object.entries(files)));
  }

  /** Relative, inside the workspace, no `..`. A bad path throws a message the model can act on. */
  static checkPath(path: string): string {
    const parts = path.split('/');
    if (
      !path ||
      path.startsWith('/') ||
      path.includes('\\') ||
      parts.includes('..') ||
      parts.includes('')
    ) {
      throw new Error(
        `path "${path}" must be relative to the repository root and must not contain ".." or empty segments`,
      );
    }
    return path;
  }

  read(path: string): string {
    const content = this.files.get(Workspace.checkPath(path));
    if (content === undefined)
      throw new Error(`no such file: ${path}. Use list_files to see what exists.`);
    return content;
  }

  list(): string[] {
    return [...this.files.keys()].sort();
  }

  search(query: string): string[] {
    return this.list().filter((p) => (this.files.get(p) as string).includes(query));
  }

  write(path: string, content: string): void {
    this.files.set(Workspace.checkPath(path), content);
    this.written.add(path);
  }

  /** Every file written since the workspace was created, with its current content. */
  changes(): Record<string, string> {
    return Object.fromEntries(
      [...this.written].sort().map((p) => [p, this.files.get(p) as string]),
    );
  }
}

export interface TestResult {
  passed: boolean;
  summary: string;
}

/** The test port. A real one runs the project's test command; the shipped one is a fixture. */
export type TestRunner = (workspace: Workspace) => TestResult;

/** Fixture runner: fails when any file still contains a FIXME marker. */
export const markerTestRunner: TestRunner = (workspace) => {
  const bad = workspace.search('FIXME');
  return bad.length === 0
    ? { passed: true, summary: `${workspace.list().length} files checked, no FIXME markers` }
    : { passed: false, summary: `FIXME found in ${bad.join(', ')}` };
};
