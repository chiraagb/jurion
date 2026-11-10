import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { api } from "@/lib/api";

// Numbers come from the latest evaluation run (/evaluation), so they stay true when it is re-run.
type Score = Record<string, number>;
interface Eval {
  baseline?: { summary: Record<string, Record<string, Score>> };
  retrieval?: { summary: Record<string, Record<string, Score>> };
  answers?: { summary: Record<string, Record<string, number | null>> };
}
const pct = (n?: number | null) => (n === null || n === undefined ? "?" : `${Math.round(n * 100)}%`);

type Status = "fixed" | "improved" | "built" | "open";
const BADGE: Record<Status, { label: string; cls: string }> = {
  fixed: { label: "Fixed", cls: "bg-accent/15 text-accent-fg" },
  improved: { label: "Improved", cls: "bg-accent/10 text-accent-fg" },
  built: { label: "Built, not yet proven", cls: "bg-warn/15 text-fg" },
  open: { label: "Still open", cls: "bg-danger/10 text-danger" },
};

interface Card { title: string; wrong: string; example?: string; fix: ReactNode; result?: ReactNode; status: Status }
interface Stage { n: number; title: string; blurb: string; cards: Card[] }

function stages(e: Eval | null): Stage[] {
  const now = e?.retrieval?.summary, before = e?.baseline?.summary, ans = e?.answers?.summary;
  return [
    {
      n: 1, title: "Reading the contract", blurb: "If the contract is cut up wrongly, nothing after this step can be right. Garbage in, garbage out.",
      cards: [
        {
          title: "A PDF is a picture of words, not a document",
          wrong: "A PDF does not say where a clause starts or where a table is. It only says where each word sits on the page. A table is just lines and words floating in a grid.",
          example: "Our first Clinical Trial Agreement came back as 4 clauses with no tables at all.",
          fix: <>We look at font size, bold text, clause numbers and page layout, not only the words. Tables are rebuilt from their cells, or from where the words sit when there are no lines. A <b>confidence score</b> warns us when a split looks wrong, and only then is an AI asked one narrow question: <i>“which lines are headings?”</i> The text itself still comes from the PDF, so the AI can never reword a clause.</>,
          result: "The same agreement now parses into 71 clauses with its tables kept. Still weak on some files (see “Still open”).",
          status: "improved",
        },
        {
          title: "Cutting every 500 words chops a clause in half",
          wrong: "Most RAG tools cut text into equal-sized pieces. A rule like “Either party may terminate…” can end up split across two pieces, so neither piece makes sense alone.",
          fix: <>We cut at the contract's own headings (“ARTICLE IV”, “Section 14.2”), so <b>one piece is one clause</b>. We also keep the full text and each clause's line range, so a clause can be re-cut later without reading the PDF again.</>,
          status: "fixed",
        },
      ],
    },
    {
      n: 2, title: "Finding the right text", blurb: "The AI can only answer from what search hands it. If search misses the right clause, the answer is wrong or missing.",
      cards: [
        {
          title: "Search by meaning misses exact words, and search by words misses meaning",
          wrong: "Meaning search understands that “who pays the lawyers?” matches “each party bears its own legal costs”, but it can be vague about exact things like “Section 14.2”. Word search is the opposite.",
          fix: <>We run <b>both</b> and merge their rankings (hybrid search). A clause that shows up in both lists rises to the top.</>,
          result: <>Right clause in the top 5: meaning only <b>{pct(now?.all?.vector?.["hit@5"])}</b>, words only <b>{pct(now?.all?.keyword?.["hit@5"])}</b>, hybrid <b>{pct(now?.all?.hybrid?.["hit@5"])}</b>. Honest note: hybrid is only slightly better than meaning alone on our questions, and word search alone is weak because a question rarely has all its words in one clause. We tried matching “any word” instead; it helped questions that copy the contract's words but hurt questions asked in other words, so we kept the original.</>,
          status: "improved",
        },
        {
          title: "A heading with no text of its own",
          wrong: "Some clauses are only a title, such as “TERMS AND CONDITIONS”. The real content is in the clauses after it. Search finds the title and the AI is given an empty heading.",
          example: "Asked “What are the terms and conditions?”, the app answered “the details are not provided”, because that is all the heading contained.",
          fix: <>When a clause found by search is only a heading, we also hand over the clauses that follow it.</>,
          result: <>For questions about a whole section, the right text is in the top 3 results <b>{pct(before?.broad?.hybrid?.["hit@3"])} → {pct(now?.broad?.context?.["hit@3"])}</b> of the time, and in first place <b>{pct(before?.broad?.hybrid?.["hit@1"])} → {pct(now?.broad?.context?.["hit@1"])}</b> (only 4 such questions, so treat it as a clear sign, not a precise number).</>,
          status: "fixed",
        },
        {
          title: "Which contract do you mean?",
          wrong: "With several contracts saved, search can pull a good-looking clause from the wrong one, and the AI then fills the gap with a guess.",
          example: "Asked “What does the bank owe if it ends the contract early?”, the app used a template services agreement that has no bank in it and wrote “(in this case, the bank)”. Only the Oriental Financial contract has a bank.",
          fix: <>The relevance check now sees each clause's <b>contract name</b> and rejects clauses from a contract that does not contain the party the question names. The answer must say which contract each statement comes from and must never guess which party you mean. <b>Then the graph:</b> before searching, Ask now asks which contracts the question names (by company, role or kind of document, such as “the bank” or “the clinical trial agreement”), using the parties stored in Neo4j, and searches only those first. If that finds nothing relevant it searches everything.</>,
          result: <>The two questions that named a contract and used to fail (“the bank…”, “the clinical trial agreement…”) are now answered from the right contract with the right clause cited. Answers that were confident, cited, but from the wrong clause: <b>{pct(ans?.all?.answered_wrong_clause)}</b> in the latest run on 15 contracts (it was 4.5% on 5 contracts, and it moves from run to run because AI answers are not identical every time). Two of the remaining mistakes are still questions that name a contract but were answered from a look-alike one.</>,
          status: "improved",
        },
      ],
    },
    {
      n: 3, title: "Answering without making things up", blurb: "AI models would rather say something than nothing. In contracts, an invented answer is worse than no answer.",
      cards: [
        {
          title: "The AI answers even when the contract doesn't say",
          wrong: "Give a model a few vaguely related clauses and it will still write a confident answer.",
          fix: <>Every clause found is first <b>graded for relevance</b>. If none passes, the question is rewritten once and tried again. If still nothing, the app says <i>“I couldn't find this in your saved contracts”</i> and the answer-writing AI is <b>never called</b>, so it cannot invent anything. When it does answer, it may use only the relevant clauses and must cite them.</>,
          result: <>Questions the contracts cannot answer, correctly refused: <b>{pct(ans?.none?.correctly_refused)}</b> (4 questions). Claims in answers that the cited clauses support: <b>{pct(ans?.all?.faithfulness)}</b>.</>,
          status: "fixed",
        },
        {
          title: "Vaguely worded questions",
          wrong: "People ask “can we cancel early?” but the contract says “termination for convenience”. The words do not match.",
          fix: <>If nothing relevant is found, the question is rewritten in contract language and tried <b>once more</b>. Only once: no endless retry loops, so cost and waiting time stay bounded.</>,
          result: "We built this, but we have not measured its effect on its own, so we do not claim it helps.",
          status: "built",
        },
        {
          title: "Citations that do not point anywhere",
          wrong: "A citation is only useful if you can click it. Early on, on broad questions, the AI wrote clause numbers like [1.1] instead of source numbers like [1], and nothing linked.",
          fix: <>The prompt now says the number in brackets is a source number, never a clause number. Each citation is a button that opens that exact source.</>,
          result: <>Answers citing the right clause: <b>{pct(ans?.all?.right_clause_cited)}</b> of answerable questions.</>,
          status: "fixed",
        },
      ],
    },
    {
      n: 4, title: "Letting you check, and checking ourselves", blurb: "A system that cannot be checked cannot be trusted, and that includes our own testing.",
      cards: [
        {
          title: "“How do I know this is right?”",
          wrong: "A fluent answer sounds right whether it is or not.",
          fix: <>Every citation opens the <b>real PDF page with the clause shaded</b> and its full text beside it. Every chat is kept as a <b>session</b> you can reopen, with a meter of how much of its context is used.</>,
          status: "built",
        },
        {
          title: "Even the AI judge can be wrong",
          wrong: "We used an AI to mark whether each answer was a refusal. It said “refused” for clear, correct answers and made the app look as if it answered only 16% of questions.",
          fix: <>We tested the judge on answers we had read ourselves, found it broken, and replaced it with a plain text rule for that yes/no question. The AI judge is kept only for checking claims against clauses, and we read rows by hand. <b>Lesson: evaluate your evaluator.</b></>,
          status: "fixed",
        },
        {
          title: "Numbers, not feelings",
          wrong: "It is easy to believe a fix works because it sounds clever.",
          fix: <>83 questions with known answers across 15 contracts (same-words, other-words, whole-section, naming a contract, needing two clauses, and unanswerable) are run after every change; see the <b>Evaluation</b> tab. Measuring showed two sensible-sounding ideas did <b>not</b> help (matching any word, and adding the section title to each embedding), so we dropped or ignored them.</>,
          result: "The set is small: one question is worth about 2.6 points, so a point or two is noise.",
          status: "improved",
        },
      ],
    },
    {
      n: 5, title: "The basics that quietly break real systems", blurb: "Not glamorous, but each of these has hurt real projects.",
      cards: [
        { title: "The same file uploaded twice", wrong: "Duplicates fill search results with the same clause twice and skew everything.", fix: <>A fingerprint (SHA-256) of each PDF is checked on save, per user. Saving a copy offers “Replace it with this result”.</>, status: "fixed" },
        { title: "Two databases that can disagree", wrong: "Contract text lives in Postgres and the connections live in Neo4j. If something is deleted in one and not the other, they drift apart.", example: "Our own tests left 5 stray contracts in Neo4j for exactly this reason.", fix: <>Postgres is the source of truth and the graph can be rebuilt from it. We added a cleanup, fixed the tests and checked both match. A production version would also add an outbox and a nightly reconcile job.</>, status: "improved" },
        { title: "Contract text leaves your machine", wrong: "Reading parties, grading and answering use outside AI services (OpenAI), so contract text is sent to them.", fix: <>It is a decision, not an accident: API keys are stored encrypted, uploads are size-, page- and time-limited, requests are rate-limited, and the owner chose to include the private contracts. A stricter setting would keep some contracts local only.</>, status: "built" },
      ],
    },
    {
      n: 6, title: "What is still open", blurb: "Saying this plainly is part of the answer.",
      cards: [
        { title: "Search still misses some questions", wrong: "Questions that do not name a contract and use different words from the clause (for example “Who pays for the lawyers if there is a dispute?”) can still rank the right clause low, or miss it.", fix: <>The graph already fixes the case where the question names the contract (“the clinical trial agreement start”). The rest needs better retrieval, not more graph, and a larger test set to measure it.</>, status: "open" },
        { title: "Some PDFs still parse badly", wrong: "Of 30 public test contracts, 4 failed or parsed badly locally. Three real causes were found and fixed: a signature page placed first swallowing the whole contract (a 47-page agreement went from 0 to 172 clauses), sections numbered “1)” and bold unnumbered headings. Scans are now read by OCR. Two-column pages and the rest of the 37 poor parses in the full set are not yet looked at.", fix: <>Each fix was tested on the same 30 contracts: 4 improved and the other 26 were unchanged. The extra heading styles run only when the normal rules find nothing, so they cannot change a contract that parses today. OCR text can contain errors and the result says so.</>, status: "improved" },
        { title: "Company names that are written differently", wrong: "“Acme Corp.” and “Acme Corporation Inc.” used to become two companies in the graph.", fix: <>Names are now normalised before they are compared (punctuation, accents, “the”, “and” and legal endings like Inc and Ltd are ignored), and companies stored under the old rule are merged on every start. Nicknames (“Acme Group”) are still separate, which needs an AI or human check.</>, status: "improved" },
      ],
    },
  ];
}

export default function ProblemsPage() {
  const [data, setData] = useState<Eval | null>(null);
  const [docs, setDocs] = useState<{ graph_parties: number | null; graph_refs: number | null }[]>([]);
  useEffect(() => {
    api.get<Eval>("/evaluation").then((r) => setData(r.data)).catch(() => setData(null)); // the page reads fine without numbers
    api.get("/documents").then((r) => setDocs(r.data)).catch(() => {});
  }, []);

  return (
    <section aria-labelledby="prob-title" className="space-y-10">
      <div>
        <p className="caption mb-3">The point of the project, in plain English</p>
        <h1 id="prob-title" className="font-display text-4xl font-semibold tracking-tight">Problems we found, and how we fix them</h1>
        <p className="mt-4 max-w-3xl text-lg text-fg-soft">
          Jurion lets you ask questions about your contracts and get answers you can check. A simple version of that, “search the text, give it to an AI”,
          breaks in predictable places. Everything on this page is a problem <b>we actually hit</b> while building it, what we did, and what the numbers say.
        </p>
      </div>

      <div className="rounded-md border border-accent/40 bg-accent/5 p-5">
        <p className="font-semibold">The crux in one breath</p>
        <p className="mt-1 max-w-3xl text-fg-soft">
          Answers are only as good as <b>how the contract was cut up</b>, <b>whether search found the right clauses</b>, and <b>whether the AI stays inside them</b>.
          So Jurion splits contracts at real headings, searches by meaning and by words, checks every clause is relevant, refuses when it has no evidence, and shows you the
          exact page for every claim. Then it <b>measures itself</b> and reports what did not work.
        </p>
        <ol className="mt-4 flex flex-wrap items-center gap-2 text-sm" aria-label="How a question is answered">
          {["Read the PDF", "Cut at real headings", "Find clauses (meaning + words)", "Check each is relevant", "Answer only from them, with citations", "Show the page", "Measure"].map((s, i, a) => (
            <li key={s} className="flex items-center gap-2">
              <span className="rounded-md border border-line-strong bg-surface px-2.5 py-1">{s}</span>
              {i < a.length - 1 && <ArrowRight className="h-3.5 w-3.5 text-subtle" aria-hidden />}
            </li>
          ))}
        </ol>
      </div>

      <WhyRag docs={docs} />

      <div>
        <p className="caption mb-2">Problem by problem</p>
        <h2 className="font-display text-3xl font-semibold tracking-tight">What we hit, and what we did</h2>
      </div>

      {stages(data).map((st) => (
        <div key={st.n} className="space-y-4">
          <div>
            <h2 className="font-display text-2xl font-semibold"><span className="mr-2 font-mono text-base text-accent">{st.n}</span>{st.title}</h2>
            <p className="mt-1 max-w-3xl text-fg-soft">{st.blurb}</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {st.cards.map((c) => (
              <article key={c.title} className="flex flex-col gap-3 rounded-md border border-line bg-surface p-5">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="font-semibold leading-snug">{c.title}</h3>
                  <span className={`shrink-0 rounded-md px-2 py-1 font-mono text-xs ${BADGE[c.status].cls}`}>{BADGE[c.status].label}</span>
                </div>
                <Row label="What goes wrong">{c.wrong}</Row>
                {c.example && <Row label="Real example"><span className="italic">{c.example}</span></Row>}
                <Row label="What we do">{c.fix}</Row>
                {c.result && <Row label="Result">{c.result}</Row>}
              </article>
            ))}
          </div>
        </div>
      ))}

      <p className="max-w-3xl text-sm text-muted">
        Numbers marked above come from the most recent run on the <b>Evaluation</b> tab (77 answerable questions across 15 contracts) and update when it is re-run.
        “?” means that run has no value for it yet.
      </p>
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-wide text-subtle">{label}</p>
      <p className="mt-0.5 text-sm leading-relaxed text-fg-soft">{children}</p>
    </div>
  );
}

const FAILS = [
  {
    title: "It matches words, not “who” or “which”",
    why: "Search finds text that sounds like the question. It has no idea which company a clause belongs to or which contract it came from.",
    example: "“What does the bank owe if it ends the contract early?” The word “bank” appears in only one of our five contracts. Plain search still pulled termination clauses from a template agreement with no bank in it, and the AI wrote “(in this case, the bank)”, a pure guess.",
    seen: true,
  },
  {
    title: "It reads pieces, not the whole",
    why: "Each clause is searched on its own. But clauses lean on each other: “subject to Section 8”, “as defined in Article 18”. Search brings back the first clause and leaves the one it depends on behind, so the answer can be incomplete or wrong.",
    example: "In our contracts, clause 9.1 “Term” points at clause 9 “TERMINATION”. A question like “how long does it run, and can it end early?” needs both, but search only returns whichever sounds closer.",
    seen: false,
  },
  {
    title: "It cannot compare across documents",
    why: "Each piece is judged alone, so questions about patterns or shared things (“which contracts involve the same company?”, “who is on the other side of every deal?”) have no single piece that answers them.",
    example: "With 10 or 100 contracts, finding every contract a company appears in means reading all of them. Nothing in plain search keeps that link.",
    seen: false,
  },
  {
    title: "A piece loses the context it lived in",
    why: "Once cut out, a clause forgets its surroundings. A heading with no text, or “2.1 Duration” without knowing it sits under “TERM”, is hard to match.",
    example: "Asked “What are the terms and conditions?”, search found a clause that said only “TERMS AND CONDITIONS” and the answer was “not provided”. The real content was in the clauses after it.",
    seen: true,
  },
  {
    title: "It sounds sure even when it should not be",
    why: "A language model writes fluent answers from whatever it is given, including weak matches. Search gives no signal for “the answer is not in your documents”.",
    example: "Without the safeguards described below, the app would answer from the closest clause even when no clause answers the question.",
    seen: true,
  },
];

/** Why plain RAG falls short, and what a graph adds (and what it does not yet do here). */
function WhyRag({ docs }: { docs: { graph_parties: number | null; graph_refs: number | null }[] }) {
  const built = docs.filter((d) => d.graph_parties !== null);
  const parties = built.reduce((a, d) => a + (d.graph_parties ?? 0), 0);
  const refs = built.reduce((a, d) => a + (d.graph_refs ?? 0), 0);
  return (
    <div className="space-y-10">
      <div className="space-y-4">
        <div>
          <p className="caption mb-2">Why plain RAG is not enough</p>
          <h2 className="font-display text-3xl font-semibold tracking-tight">Why “search, then ask the AI” falls short</h2>
          <p className="mt-3 max-w-3xl text-fg-soft">
            <b>RAG</b> (retrieval-augmented generation) is an <b>open-book exam</b>. Instead of answering from memory, the AI is first handed the most relevant
            pages from your documents, then answers from those pages. It works well for simple questions. It struggles when the answer depends on
            <b> who</b> is involved, <b>which</b> document, or <b>how pieces connect</b>, because the “pages” are handed over one at a time with no map between them.
          </p>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          {FAILS.map((f, i) => (
            <article key={f.title} className="flex flex-col gap-3 rounded-md border border-line bg-surface p-5">
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-semibold leading-snug"><span className="mr-2 font-mono text-accent">{i + 1}</span>{f.title}</h3>
                <span className={`shrink-0 rounded-md px-2 py-1 font-mono text-xs ${f.seen ? "bg-accent/10 text-accent-fg" : "bg-warn/15 text-fg"}`}>
                  {f.seen ? "Seen in our data" : "Expected, not yet measured"}
                </span>
              </div>
              <Row label="Why it happens">{f.why}</Row>
              <Row label="Example"><span className="italic">{f.example}</span></Row>
            </article>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div>
          <p className="caption mb-2">The need for GraphRAG</p>
          <h2 className="font-display text-3xl font-semibold tracking-tight">What a graph adds</h2>
          <p className="mt-3 max-w-3xl text-fg-soft">
            Back to the exam: plain RAG is a student who grabs the pages that <i>sound</i> most like the question. <b>GraphRAG</b> is a student who also has a
            <b> map</b>, a table of contents plus a family tree: which company is on which contract, and which clause points at which. With the map they walk to the right
            shelf instead of guessing from the covers.
          </p>
          <p className="mt-3 max-w-3xl text-fg-soft">
            A <b>graph</b> is just dots and lines. Our dots are <b>companies</b>, <b>contracts</b> and <b>clauses</b>. Our lines say <i>“is a party to”</i>,
            <i> “contains”</i> and <i>“refers to”</i>. The same company in two contracts is <b>one dot with two lines</b>, and that shared dot is what connects the contracts.
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          {[
            { t: "Narrow", d: "The question names a party, so search only the contracts where that party appears.", e: "“the bank” points to the one contract with a bank in it. The template agreement is never searched." },
            { t: "Widen", d: "Follow “refers to” lines from a found clause and bring in the clause it depends on.", e: "Found “9.1 Term”? Also bring in “9 TERMINATION”, because the answer needs both." },
            { t: "Connect", d: "Link the same company across contracts, so questions about patterns have something to stand on.", e: "“Which of my contracts involve Metavante?” becomes one step along the lines, not a reread of everything." },
          ].map((x) => (
            <article key={x.t} className="rounded-md border border-line bg-surface p-5">
              <h3 className="font-display text-xl font-semibold">{x.t}</h3>
              <p className="mt-1 text-sm text-fg-soft">{x.d}</p>
              <p className="mt-3 text-sm italic text-muted">{x.e}</p>
            </article>
          ))}
        </div>

        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full border-collapse text-sm">
            <caption className="bg-raised px-3 py-2 text-left font-semibold">The same question, with and without the graph: “What does the bank owe if it ends the contract early?”</caption>
            <thead className="text-left"><tr><th className="w-1/2 px-3 py-2">Plain RAG (what we had)</th><th className="px-3 py-2">With the graph (the plan)</th></tr></thead>
            <tbody>
              <tr className="border-t border-line align-top">
                <td className="px-3 py-3 text-fg-soft">Searches all five contracts. A template agreement has the best-sounding termination clause. The AI answers from it and guesses “(in this case, the bank)”.</td>
                <td className="px-3 py-3 text-fg-soft">The graph says “bank” is a party only to the Oriental Financial contract, so only that contract is searched, and the clause it depends on is added. If its clause is not found, the app says so.</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="rounded-md border border-warn/40 bg-warn/10 p-5">
          <p className="flex flex-wrap items-center gap-2 font-semibold">
            Where we really are
            <span className="rounded-md bg-warn/20 px-2 py-0.5 font-mono text-xs font-normal">Graph used by Ask · small, measured gain</span>
          </p>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm text-fg-soft">
            <li>
              <b>Built:</b> the graph exists and is filled for your saved contracts: <b>{built.length}</b> contracts, <b>{parties}</b> companies and people, <b>{refs}</b> “refers to” links
              (see the Graph panel on each contract, or Neo4j at localhost:7474).
            </li>
            <li><b>Used by Ask:</b> it narrows a question to the contracts it names, and pulls in clauses that a found clause refers to (they are marked “pulled in by 9.1” on the reference cards).</li>
            <li><b>What the numbers say</b> (Evaluation tab): on the same 38 questions, the right clause was cited <b>89.5% → 94.7%</b> of the time and answers were fully faithful, mostly because the two “name a contract” questions that always failed now work. Overall search is about the same as without the graph. It is a real fix for one kind of failure, not a large across-the-board gain, and one run on 44 questions cannot say more.</li>
            <li><b>Not proven:</b> the cross-reference widening is built and tested, but our questions do not isolate it, so we claim nothing for it yet. And narrowing can hurt: our first version, which guessed a contract from the topic, broke 4 questions before we limited it to names, roles and kinds of document.</li>
          </ul>
        </div>

        <div className="rounded-md border border-line bg-surface p-5">
          <p className="font-semibold">When GraphRAG is not needed (honest answer)</p>
          <p className="mt-1 max-w-3xl text-sm text-fg-soft">
            For a single document, or a question answered by one passage (“what are the payment terms?”), plain hybrid search is enough and cheaper. In our own test it put the right clause in the
            top 5 for most questions. The graph only targets what is left: <b>which contract</b>, <b>what depends on what</b>, and <b>patterns across contracts</b>. It also costs more: a second database to keep in step, and
            mistakes in who-is-who spread through it. That is why it is measured, not assumed.
          </p>
        </div>
      </div>
    </div>
  );
}
