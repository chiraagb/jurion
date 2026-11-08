"""Runs every integration test as its own process, prints one line each, and exits non-zero if any failed.
Needs Postgres (pgvector), Redis and Neo4j running (docker compose up). No OpenAI call is made: the tests use fakes.
  uv run python -W ignore -m tests.run_all"""
import subprocess
import sys
import time

TESTS = ["test_parse", "test_limits", "test_corpus", "test_documents", "test_search", "test_ask", "test_ask_graph", "test_graph", "test_reconcile", "test_party_names", "test_migrations"]

failed = []
for name in TESTS:
    t0 = time.time()
    run = subprocess.run([sys.executable, "-W", "ignore", "-m", f"tests.integration.{name}"], capture_output=True, text=True)
    lines = [l for l in (run.stdout + run.stderr).strip().splitlines() if l.strip()]
    ok = run.returncode == 0
    print(f"{'PASS' if ok else 'FAIL'}  {name:<16} {time.time() - t0:5.1f}s  {lines[-1][:110] if lines else ''}")
    if not ok:
        failed.append(name)
        print("\n".join("      " + l for l in lines[-12:]))
print(f"\n{len(TESTS) - len(failed)}/{len(TESTS)} passed" + (f"; failed: {', '.join(failed)}" if failed else ""))
sys.exit(1 if failed else 0)
