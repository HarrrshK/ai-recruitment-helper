import hashlib
import itertools
import random
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from datetime import UTC, datetime

from sqlalchemy import delete, select
from app.models import Company, DevTask, EmbeddingEntry, Job, Resume, User

executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="dev-task")
task_lock = Lock()


def recover_interrupted_tasks(factory):
    """Recover the single-process maintenance worker after a server restart."""
    with factory() as db:
        for task in db.scalars(select(DevTask).where(DevTask.status == "running")):
            task.status = "failed"
            task.result = {"error": "WorkerRestarted", "message": "Server restarted before completion. Run the operation again."}
        db.commit()


def benchmark():
    from app.agents.matcher import quote_in_text
    from app.agents.resume_parser import Education, ParsedProfile
    from app.services.anonymizer import anonymize_resume
    from app.services.evaluation import pairwise_accuracy
    checks = []
    for i in range(40):
        name = f"Alex Person{i}"
        email = f"person{i}@example.com"
        location = f"City{i}"
        school = f"University{i}"
        profile = ParsedProfile(name=name, email=email, location=location, education=[Education(degree="BSc", institution=school)])
        text = f"{name}\n{email}\n{location}\nBSc at {school}\nBuilt Python APIs for {i + 1} years."
        output = anonymize_resume(text, profile)
        checks.append({"group": "Bias Shield", "name": f"Identity redaction {i + 1}", "passed": all(v not in output for v in (name, email, location, school)) and "Python APIs" in output})
    for i in range(40):
        text = f"Built {i + 1} Python services. Reduced latency by {i + 5} percent."
        quote = f"Built {i + 1} Python services." if i % 2 == 0 else "Managed a nuclear power station."
        checks.append({"group": "Verbatim evidence", "name": f"Quote verification {i + 1}", "passed": bool(quote_in_text(quote, text)) == (i % 2 == 0)})
    rng = random.Random(927)
    for i in range(47):
        scores = [rng.randint(0, 100) for _ in range(8)]
        grades = [rng.randint(0, 3) for _ in range(8)]
        pairs = [(a, b) for a, b in itertools.combinations(range(8), 2) if grades[a] != grades[b]]
        correct = sum(.5 if scores[a] == scores[b] else float((scores[a] > scores[b]) == (grades[a] > grades[b])) for a, b in pairs)
        expected = correct / len(pairs) if pairs else 1
        checks.append({"group": "Pair ranking", "name": f"Rank ordering {i + 1}", "passed": abs(pairwise_accuracy(scores, grades) - expected) < 1e-9})
    return {"checks": checks, "passed": sum(c["passed"] for c in checks), "total": len(checks), "mode": "deterministic regression; no live model calls"}


def reindex(factory, embedder):
    from app.services.embeddings import MODEL_NAME
    with factory() as db:
        texts = [r.text for r in db.scalars(select(Resume).where(Resume.archived.is_(False)))]
        texts += [j.brief + "\n" + (j.description or {}).get("markdown", "") for j in db.scalars(select(Job))]
        texts += [c.knowledge or "" for c in db.scalars(select(Company))]
    texts = list(dict.fromkeys(t for t in texts if t.strip()))
    entries = []
    for start in range(0, len(texts), 32):
        batch = texts[start:start + 32]
        vectors = embedder.embed(batch)
        entries.extend(EmbeddingEntry(key=hashlib.sha256((MODEL_NAME + t).encode()).hexdigest(), model=MODEL_NAME, vector=v.tolist()) for t, v in zip(batch, vectors))
    # Keep the previous index intact until all new vectors are ready.
    with factory() as db:
        db.execute(delete(EmbeddingEntry).where(EmbeddingEntry.model == MODEL_NAME))
        db.add_all(entries)
        db.commit()
    return {"indexed": len(entries), "model": MODEL_NAME}


def run_task(factory, task_id, function, actor_id=None):
    try:
        result = function()
        status = "completed"
    except Exception as error:
        result, status = {"error": type(error).__name__, "message": "Operation failed. Check server logs before retrying."}, "failed"
        import logging
        logging.getLogger(__name__).exception("Developer task failed")
    with factory() as db:
        task = db.get(DevTask, task_id)
        if task:
            task.status, task.result = status, result
            if actor_id is not None:
                from app.services.audit import record
                actor = db.get(User, actor_id)
                if actor:
                    record(db, actor, f"task.{status}", task.id, {"kind": task.kind})
            db.commit()
