# 5. Git & GitHub

One git repo at the project root (`jurion/`) covers backend, frontend and docs together.

## First-time setup

```bash
cd jurion
rm -rf backend/.git                      # remove the empty repo created by `uv init`
printf '.DS_Store\n.env*\n' > .gitignore # root ignore file
git init -b main
git add -A
git status                               # check: no .env, node_modules, .venv listed
git commit -m "Initial commit: Jurion scaffold + docs"
```

> Why remove `backend/.git`? `uv init` creates its own repo inside `backend/`. If it stays, git treats `backend/` as a separate repo and won't add its files.

> `.env` files hold passwords and API keys. They're ignored in root, `backend/` and `frontend/` – never commit them.

## Push to GitHub

**Option A – GitHub CLI** (creates the repo and pushes in one step):

```bash
brew install gh     # if you see "gh: command not found"
gh auth login       # one-time sign-in
gh repo create jurion --private --source=. --push
```

**Option B – manually**, after creating an empty repo on github.com:

```bash
git remote add origin git@github.com:<your-username>/jurion.git
git push -u origin main
```

## Everyday workflow

```bash
git status                  # what changed
git add -A                  # stage everything
git commit -m "Describe the change"
git push                    # send to GitHub
```
