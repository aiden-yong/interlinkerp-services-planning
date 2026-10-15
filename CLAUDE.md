# InterlinkERP Planning

Planning app for the Services department of InterlinkERP, modelled on Odoo Planning.

- Stack: Next.js 16 (App Router) + React 19 + TypeScript, Drizzle ORM, PostgreSQL (local 18, Neon in production), Vercel `sin1`. Server code in `src/server` never imports React; client code in `src/client` never imports `src/server`.
- Requirements: [ListOfRequirements.md](ListOfRequirements.md) (lean ISO/IEC/IEEE 29148 SRS). Keep requirement IDs stable; mark removed ones *Withdrawn*.
- Naming: the ERP is **InterlinkERP**. Use only that name. When copying code, comments or docs from the sibling `hr-recruitment-demo` repo, replace its old ERP brand name with InterlinkERP everywhere (identifiers, comments, docs).
- Commits: no Claude attribution lines (no Co-Authored-By trailer, no "Generated with Claude Code").
