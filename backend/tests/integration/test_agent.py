"""Agent mode of Ask with a scripted stand-in for the chat model (no network, no OpenAI/Anthropic call).
Run: uv run python -W ignore -m tests.integration.test_agent"""
import json
import uuid
import redis
from fastapi.testclient import TestClient
from langchain_core.messages import AIMessage, AIMessageChunk
from app import agent, ask, documents, embeddings
from app.auth import current_user
from app.config import settings
from app.database import AsyncSessionLocal, User
from app.graph import drop_user as drop_user_graph
from app.main import app
from tests.integration.test_parse import make_sample_pdf
from tests.integration.test_search import RESULT, fake_embed


def events(r):
    assert r.status_code == 200, r.text
    return [json.loads(l) for l in r.text.splitlines()]


def call(name, **args):
    return AIMessage(content="", tool_calls=[{"name": name, "args": {"reason": "because", **args}, "id": uuid.uuid4().hex[:8]}])


class Scripted:
    """Plays back planned AIMessages (then `finish`), and streams a fixed answer. `blocks` makes the answer arrive as content blocks, like Anthropic's models."""
    def __init__(self, plan, answer="Thirty days [1].", blocks=False):
        self.plan, self.answer, self.blocks, self.planned = list(plan), answer, blocks, 0

    def bind_tools(self, tools): return self

    async def ainvoke(self, msgs):
        self.planned += 1
        return self.plan.pop(0) if self.plan else call("finish", found=False)

    async def astream(self, prompt):
        assert self.answer is not None, "the answer model must not run without evidence"
        for t in (self.answer[:7], self.answer[7:]):
            yield AIMessageChunk(content=[{"type": "text", "text": t}] if self.blocks else t)


if __name__ == "__main__":
    async def a_key(*_): return "sk-fake"
    async def no_key(*_): return None
    async def no_followups(*_): return []
    r = redis.Redis.from_url(settings.REDIS_URL)

    def post(c, path="/ask", **body):
        r.delete("rl:ask:testclient", "rl:compare:testclient")  # the per-minute limits would trip on this many calls
        body = {"question": "terminate notice", "mode": "agent"} | body
        return c.post(path, json={k: v for k, v in body.items() if v is not None})  # mode=None: send no mode at all

    # unit: the tool list is read-only and every tool carries a description and a `reason`
    assert set(agent.TOOLS) == {"list_contracts", "search_clauses", "read_clause", "follow_references", "company_info", "library_stats", "ask_user", "finish"}
    for name, (model, desc) in agent.TOOLS.items():
        assert desc and "reason" in model.model_fields and model.model_fields["reason"].is_required(), name
    assert "ask_user" not in [t.name for t in agent._tool_objects(False)]

    with TestClient(app) as c:
        async def make_user():
            async with AsyncSessionLocal() as db:
                u = User(google_sub=f"test-agent-{uuid.uuid4().hex[:8]}", email="agent@example.com")
                db.add(u)
                await db.commit()
                return u

        async def drop(u):
            async with AsyncSessionLocal() as db:
                await drop_user_graph(u.id)
                await db.delete(await db.get(User, u.id))
                await db.commit()

        user = c.portal.call(make_user)
        saved = dict(ask=(ask.openai_key, ask.followups, ask.grade, ask.answer_stream, ask.contract_cards, ask.references_from), agent=(agent.provider_key, agent.build_model),
                     emb=(embeddings.embed_texts, embeddings.openai_key, documents.openai_key), tokens=(settings.AGENT_MAX_STEPS, settings.AGENT_MAX_TOOL_CALLS))
        try:
            embeddings.embed_texts = fake_embed
            embeddings.openai_key = documents.openai_key = ask.openai_key = agent.provider_key = a_key
            ask.followups = no_followups
            app.dependency_overrides[current_user] = lambda: user
            assert c.post("/documents", files={"file": ("a.pdf", make_sample_pdf(), "application/pdf")}, data={"result": json.dumps(RESULT)}).status_code == 201
            doc = c.get("/documents").json()[0]

            async def cards(_uid): return [{"id": doc["id"], "filename": doc["filename"], "summary": "A services agreement.", "parties": [{"name": "Brightpath", "role": "Supplier", "aliases": []}]}]
            async def no_refs(_ids): return {}
            ask.contract_cards, ask.references_from = cards, no_refs
            model = {}
            agent.build_model = lambda spec, key: model["m"]

            # 1. search, then finish with the clause it chose: step events, then the usual sources/token/done, saved with its steps
            model["m"] = Scripted([call("search_clauses", query="terminate notice", contracts=[1]), call("finish", use=[1])])
            ev = events(post(c))
            kinds = [e["event"] for e in ev]
            assert kinds == ["step", "step", "sources", "context", "token", "token", "stats", "done"], kinds
            assert ev[0]["tool"] == "search_clauses" and ev[0]["reason"] == "because" and ev[0]["hits"] and "reason" not in ev[0]["args"], ev[0]
            assert [x["clause_identifier"] for x in ev[2]["sources"]] == ["1"] and ev[2]["sources"][0]["content"]
            assert "".join(e["text"] for e in ev if e["event"] == "token") == "Thirty days [1]."
            st = ev[-2]
            assert st["mode"] == "agent" and st["steps"] == 2 and st["tool_calls"] == 2 and st["llm_calls"] >= 3 and st["model"] == settings.AGENT_MODEL, st
            turn = c.get(f"/sessions/{ev[-1]['session_id']}").json()["data"]["turns"][0]
            assert turn["mode"] == "agent" and [s["tool"] for s in turn["steps"]] == ["search_clauses", "finish"] and "hits" not in turn["steps"][0] and turn["scope"] == [doc["filename"]]

            # 1b. the same graph runs unchanged on a model that streams content blocks (another provider's shape)
            model["m"] = Scripted([call("search_clauses", query="terminate notice"), call("finish", use=[1])], blocks=True)
            ev = events(post(c))
            assert "".join(e["text"] for e in ev if e["event"] == "token") == "Thirty days [1]."

            # 2. found=false: nothing is answered from, and the answer model never runs
            model["m"] = Scripted([call("search_clauses", query="who owns the moon"), call("finish", found=False)], answer=None)
            ev = events(post(c, question="who owns the moon"))
            assert [e["event"] for e in ev][-5:] == ["sources", "token", "followups", "stats", "done"] and ev[-4]["text"] == ask.NONE_FOUND, ev

            # 3. caps: the loop stops and answers from what it has; each cap is reported
            settings.AGENT_MAX_STEPS = 2
            model["m"] = Scripted([call("search_clauses", query="terminate notice"), call("read_clause", number=1), call("search_clauses", query="more")])
            ev = events(post(c))
            assert [e["hit"] for e in ev if e["event"] == "budget"] == ["steps"] and [s["clause_identifier"] for s in next(e for e in ev if e["event"] == "sources")["sources"]] == ["1"], ev
            settings.AGENT_MAX_STEPS, settings.AGENT_MAX_TOOL_CALLS = saved["tokens"][0], 1
            two = AIMessage(content="", tool_calls=[{"name": "search_clauses", "args": {"reason": "r", "query": "notice"}, "id": "a"}, {"name": "search_clauses", "args": {"reason": "r", "query": "pay"}, "id": "b"}])
            model["m"] = Scripted([two])
            ev = events(post(c))
            assert [e["hit"] for e in ev if e["event"] == "budget"] == ["tool_calls"] and len([e for e in ev if e["event"] == "step"]) == 1, ev
            settings.AGENT_MAX_TOOL_CALLS = saved["tokens"][1]

            # 4. a bad tool call is an observation the model can recover from, not a crash; an unknown clause number is refused
            model["m"] = Scripted([AIMessage(content="", tool_calls=[{"name": "search_clauses", "args": {"reason": "r"}, "id": "x"}]), call("read_clause", number=99), call("finish", found=False)], answer=None)
            ev = events(post(c))
            steps = [e for e in ev if e["event"] == "step"]
            assert [s["observation"] for s in steps][:2] == ["tool failed", "no such clause"] and ev[-1]["event"] == "done", steps

            # 5. the user's own contract choice cannot be widened by the model: a chosen contract that holds nothing finds nothing
            model["m"] = Scripted([call("search_clauses", query="terminate notice", contracts=[1]), call("finish", found=False)], answer=None)
            ev = events(post(c, only=[str(uuid.uuid4())]))
            assert next(e for e in ev if e["event"] == "step")["observation"] == "no clauses", ev

            # 6. ask_user ends the investigation with the clarify event, like the workflow's "which contract?"
            model["m"] = Scripted([call("ask_user", question="Which contract?", contracts=[1])], answer=None)
            ev = events(post(c))
            assert [e["event"] for e in ev][-5:] == ["sources", "token", "clarify", "stats", "done"] and ev[-3]["options"][0]["id"] == doc["id"], ev

            # 7. a model that fails to start falls back to the workflow, and says so
            def broken(spec, key): raise RuntimeError("provider down")
            async def grade_first(_k, q, hits): return ask.Graded([0])
            async def fake_answer(_k, q, sources, **kw):
                yield "From the workflow."
            ask.grade, ask.answer_stream = grade_first, fake_answer
            agent.build_model = broken
            ev = events(post(c))
            kinds = [e["event"] for e in ev]
            assert kinds[0] == "fallback" and "retrieved" in kinds and "step" not in kinds and ev[-2]["mode"] == "workflow", kinds
            assert c.get(f"/sessions/{ev[-1]['session_id']}").json()["data"]["turns"][-1]["fallback"]
            agent.build_model = lambda spec, key: model["m"]

            # 8. the workflow keeps its exact events when no mode is sent, and reports its cost when a mode is named
            kinds = [e["event"] for e in events(post(c, mode="workflow"))]
            assert kinds[-2:] == ["stats", "done"], kinds
            settings.ASK_DEFAULT_MODE = "workflow"
            kinds = [e["event"] for e in events(post(c, mode=None))]
            assert "stats" not in kinds and kinds[0] == "retrieved", kinds

            # 9. models: the allow-list, the missing key, and the list endpoint
            assert post(c, model="openai:not-allowed").status_code == 400
            agent.provider_key = no_key
            res = post(c, model="anthropic:claude-sonnet-5-5")
            assert res.status_code == 400 and "anthropic" in res.json()["detail"], res.text
            ms = c.get("/ask/models").json()
            assert ms["default"] == settings.AGENT_MODEL and not any(m["available"] for m in ms["models"]), ms
            agent.provider_key = a_key
            assert any(m["available"] for m in c.get("/ask/models").json()["models"])

            # 10. compare: both sides stream tagged events, then the clause overlap; nothing is saved to a chat
            model["m"] = Scripted([call("search_clauses", query="terminate notice"), call("finish", use=[1])])
            before = len(c.get("/sessions").json())
            ev = events(post(c, "/ask/compare"))
            sides = {(e.get("system"), e["event"]) for e in ev}
            assert {("workflow", "stats"), ("agent", "stats"), ("workflow", "token"), ("agent", "token")} <= sides and ev[-1]["event"] == "compared", sides
            assert ev[-1]["same_clauses"] == 1 and not ev[-1]["only_agent"] and not ev[-1]["only_workflow"], ev[-1]
            # ...and the comparison is kept as its own kind of session, listed but never used as chat memory
            lst = c.get("/sessions").json()
            sid = ev[-1]["session_id"]
            assert len(lst) == before + 1 and [x["kind"] for x in lst if x["id"] == sid] == ["compare"], lst
            saved_cmp = c.get(f"/sessions/{sid}").json()
            d = saved_cmp["data"]
            assert saved_cmp["query"] == "terminate notice" and d["compared"]["same_clauses"] == 1 and d["agent"]["answer"] == "Thirty days [1]." and d["workflow"]["answer"] == "From the workflow.", d
            assert [x["tool"] for x in d["agent"]["steps"]] == ["search_clauses", "finish"] and "hits" not in d["agent"]["steps"][0] and d["agent"]["stats"]["mode"] == "agent"
            chat = events(post(c))  # a new chat question is a new chat: the comparison is not its memory
            assert chat[-1]["session_id"] != sid and c.get(f"/sessions/{chat[-1]['session_id']}").json()["kind"] == "chat"
            assert c.delete(f"/sessions/{sid}").status_code == 204
            print("ok: agent loop, finish/none/caps/errors, user scope, ask_user, fallback, models, compare")
        finally:
            ask.openai_key, ask.followups, ask.grade, ask.answer_stream, ask.contract_cards, ask.references_from = saved["ask"]
            agent.provider_key, agent.build_model = saved["agent"]
            embeddings.embed_texts, embeddings.openai_key, documents.openai_key = saved["emb"]
            settings.AGENT_MAX_STEPS, settings.AGENT_MAX_TOOL_CALLS, settings.ASK_DEFAULT_MODE = saved["tokens"][0], saved["tokens"][1], "workflow"
            app.dependency_overrides.clear()
            c.portal.call(drop, user)
