import { Octokit } from '@octokit/rest';

// Post agent findings as a GitHub PR comment
export async function postPRReviewComment({ owner, repo, pull_number, findings }) {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn('[PRReview] GITHUB_TOKEN not set — cannot post PR comment');
    return { ok: false, reason: 'GITHUB_TOKEN not set' };
  }

  const octokit = new Octokit({ auth: token });

  const lines = [
    '## 🤖 TIQ AI Agent — Automated Review',
    '',
    `**Codebase:** \`${repo}\` | **Scan time:** ${new Date().toLocaleString('en-IN')}`,
    '',
  ];

  if (findings.lint_errors > 0) {
    lines.push(`### ❌ Lint Errors (${findings.lint_errors})`);
    (findings.lint_details ?? []).slice(0, 10).forEach(e =>
      lines.push(`- \`${e.file}\` line ${e.line}: ${e.message}`)
    );
    lines.push('');
  }

  if (findings.critical_todos > 0) {
    lines.push(`### ⚠️ Critical TODOs / FIXMEs (${findings.critical_todos})`);
    (findings.todo_details ?? []).filter(t => t.severity === 'critical').slice(0, 10).forEach(t =>
      lines.push(`- \`${t.file}:${t.line}\`: ${t.text}`)
    );
    lines.push('');
  }

  if (findings.secrets_found > 0) {
    lines.push(`### 🔐 Potential Secrets Detected (${findings.secrets_found})`);
    lines.push('> Agent flagged possible credentials in this diff. Please review manually.');
    lines.push('');
  }

  if (findings.dead_files?.length > 0) {
    lines.push(`### 🗑️ Potentially Dead Files (${findings.dead_files.length})`);
    findings.dead_files.slice(0, 5).forEach(f => lines.push(`- \`${f}\``));
    lines.push('');
  }

  if (!findings.lint_errors && !findings.critical_todos && !findings.secrets_found) {
    lines.push('### ✅ All Checks Passed');
    lines.push('No lint errors, critical TODOs, or secrets detected.');
    lines.push('');
  }

  lines.push('---');
  lines.push('_This review was generated automatically by the TIQ AI Agent. Always verify before merging._');

  const body = lines.join('\n');

  try {
    const response = await octokit.issues.createComment({
      owner,
      repo,
      issue_number: pull_number,
      body,
    });
    console.log(`[PRReview] Comment posted: ${response.data.html_url}`);
    return { ok: true, url: response.data.html_url };
  } catch (err) {
    console.error('[PRReview] Failed to post comment:', err.message);
    return { ok: false, reason: err.message };
  }
}

// Run a full review scan and post findings to PR
export async function reviewPR({ owner, repo, pull_number, branch }) {
  console.log(`[PRReview] Reviewing PR #${pull_number} on branch ${branch}`);

  // Import scan tools dynamically (avoids circular deps)
  const { lintFile }       = await import('./tools/lintFile.js');
  const { findTodos }      = await import('./tools/findTodos.js');
  const { secretScanner }  = await import('./tools/secretScanner.js');
  const { detectDeadCode } = await import('./tools/detectDeadCode.js');
  const { config }         = await import('./config.js');

  const [lint, todos, secrets, dead] = await Promise.allSettled([
    lintFile({ file_path: config.codebasePath }),
    findTodos({ directory: config.codebasePath }),
    secretScanner({ directory: config.codebasePath }),
    detectDeadCode({ directory: config.codebasePath }),
  ]);

  const lintResult    = lint.status    === 'fulfilled' ? lint.value    : {};
  const todosResult   = todos.status   === 'fulfilled' ? todos.value   : {};
  const secretsResult = secrets.status === 'fulfilled' ? secrets.value : {};
  const deadResult    = dead.status    === 'fulfilled' ? dead.value    : {};

  const findings = {
    lint_errors:    lintResult.total_errors    ?? 0,
    lint_details:   lintResult.files?.flatMap(f => f.errors.map(e => ({ file: f.file, ...e }))) ?? [],
    critical_todos: todosResult.by_severity?.critical ?? 0,
    todo_details:   todosResult.items ?? [],
    secrets_found:  secretsResult.total ?? 0,
    dead_files:     deadResult.dead_files ?? [],
  };

  return postPRReviewComment({ owner, repo, pull_number, findings });
}
