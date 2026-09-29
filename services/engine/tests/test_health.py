def test_health_needs_no_token(client):
    res = client.get("/engine/health")
    assert res.status_code == 200
    assert res.json() == {"status": "OK"}


def test_protected_route_rejects_missing_token(client):
    res = client.post("/engine/documents/process", json={})
    assert res.status_code == 403
    assert res.json()["error"]["code"] == "FORBIDDEN"


def test_protected_route_rejects_wrong_token(client):
    res = client.post("/engine/documents/process", json={}, headers={"X-Engine-Token": "wrong"})
    assert res.status_code == 403


def test_compliance_evaluate_rejects_missing_fields(client, auth_headers):
    # /documents/process (Phase 1) and /rules/* (Phase 2) were the honest-501 examples before;
    # /compliance/evaluate is real now (Phase 4) — see test_interpreter.py, test_aggregate.py,
    # test_compliance_determinism.py for the interpreter itself. This just checks the route is
    # wired up and validates its request shape rather than 501ing.
    res = client.post("/engine/compliance/evaluate", json={}, headers=auth_headers)
    assert res.status_code == 422


def test_compliance_evaluate_end_to_end_smoke(client, auth_headers):
    res = client.post(
        "/engine/compliance/evaluate",
        json={
            "reference_date": "2026-09-15",
            "rules": [
                {
                    "requirement_id": "req-1",
                    "rule_version_id": "rv-1",
                    "dsl": {
                        "schema_version": "1.0",
                        "rule_code": "R-01",
                        "name": "PAN required",
                        "requirement_category": "IDENTITY",
                        "mandatory": True,
                        "weight": 10,
                        "envelope": "TECHNICAL",
                        "on_missing_evidence": "FAIL",
                        "expression": {"node": "SOURCE_VERIFIED", "claim_type": "PAN", "min_status": "DOCUMENT_SUPPORTED"},
                        "plain_english": "PAN must be on record.",
                        "source": {"document_id": "d1", "clause_ref": "1", "page": 1},
                    },
                }
            ],
            "bid_context": {
                "claims": [{"claim_type": "PAN", "value": "AABCX1234F", "status": "DOCUMENT_SUPPORTED", "evidence_ids": ["ev1"]}],
                "reconciliations": [],
                "documents": [],
                "tender_flags": {},
            },
        },
        headers=auth_headers,
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["results"][0]["result"] == "PASS"
    assert body["gate"]["status"] == "PASS"
    assert body["score"]["total"] == "100.00"


def test_document_process_rejects_missing_fields(client, auth_headers):
    res = client.post("/engine/documents/process", json={}, headers=auth_headers)
    assert res.status_code == 422


def test_document_process_reports_source_unavailable_honestly(client, auth_headers):
    # Never fabricates an extraction result when the file genuinely can't be fetched (spec §2).
    res = client.post(
        "/engine/documents/process",
        json={"document_id": "does-not-exist", "storage_bucket": "documents", "storage_key": "no/such/key.pdf"},
        headers=auth_headers,
    )
    assert res.status_code == 502
    assert res.json()["error"]["code"] == "SOURCE_UNAVAILABLE"


def test_unknown_verification_adapter_is_404(client, auth_headers):
    res = client.post("/engine/verify/NOT_A_REAL_ADAPTER", json={}, headers=auth_headers)
    assert res.status_code == 404


def test_known_verification_adapter_is_honest_stub(client, auth_headers):
    res = client.post("/engine/verify/STRUCTURAL", json={}, headers=auth_headers)
    assert res.status_code == 501


def test_all_engine_routes_require_token_except_health(client):
    # Spec §2 rule 9 applies here too: nothing should be reachable without the shared secret.
    protected = [
        ("/engine/documents/process", "post"),
        ("/engine/reconcile", "post"),
        ("/engine/tenders/segment", "post"),
        ("/engine/rules/compile", "post"),
        ("/engine/rules/validate", "post"),
        ("/engine/rules/render-english", "post"),
        ("/engine/compliance/evaluate", "post"),
        ("/engine/reports/render", "post"),
    ]
    for path, method in protected:
        res = getattr(client, method)(path, json={})
        assert res.status_code == 403, f"{method.upper()} {path} should require X-Engine-Token"
