from datetime import UTC, datetime
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.main import app


def unique_user_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:8]}"


def test_demo_login_simulate_and_profile_flow() -> None:
    user_id = unique_user_id("u_route")
    with TestClient(app) as client:
        login = client.post(
            "/auth/demo-login",
            json={"user_id": user_id, "display_name": "Route Pilot", "segment": "student"},
        )
        assert login.status_code == 200

        simulate = client.post(
            "/admin/simulate",
            json={
                "event_type": "txn_posted",
                "event_id": f"evt_{uuid4().hex[:8]}",
                "user_id": user_id,
                "amount": 140,
                "merchant_id": "merchant_partner_01",
                "category": "food",
                "is_partner": True,
                "is_target_category": True,
                "device_mismatch": False,
                "multi_account_signal": False,
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )
        assert simulate.status_code == 200

        profile = client.get("/galaxy/profile", params={"user_id": user_id})
        assert profile.status_code == 200
        payload = profile.json()
        assert payload["user_id"] == user_id
        assert payload["orbit_level"] >= 1
        assert len(payload["planets"]) == 3
        assert payload["active_boosters"]


def test_profile_deduplicates_active_boosters_by_category() -> None:
    user_id = unique_user_id("u_booster")
    with TestClient(app) as client:
        client.post(
            "/auth/demo-login",
            json={"user_id": user_id, "display_name": "Booster Pilot", "segment": "student"},
        )

        for amount in (110, 125, 140):
            simulate = client.post(
                "/admin/simulate",
                json={
                    "event_type": "txn_posted",
                    "event_id": f"evt_{uuid4().hex[:8]}",
                    "user_id": user_id,
                    "amount": amount,
                    "merchant_id": "merchant_partner_food",
                    "category": "food",
                    "is_partner": True,
                    "is_target_category": True,
                    "device_mismatch": False,
                    "multi_account_signal": False,
                    "timestamp": datetime.now(UTC).isoformat(),
                },
            )
            assert simulate.status_code == 200

        profile = client.get("/galaxy/profile", params={"user_id": user_id})
        assert profile.status_code == 200
        active_boosters = profile.json()["active_boosters"]

        assert len(active_boosters) == 1
        assert active_boosters[0]["category"] == "food"


def test_completed_quest_can_be_claimed() -> None:
    user_id = unique_user_id("u_claim")
    with TestClient(app) as client:
        client.post("/auth/demo-login", json={"user_id": user_id, "display_name": "Quest Pilot", "segment": "student"})
        for _ in range(3):
            client.post(
                "/admin/simulate",
                json={
                    "event_type": "txn_posted",
                    "event_id": f"evt_{uuid4().hex[:8]}",
                    "user_id": user_id,
                    "amount": 60,
                    "merchant_id": "merchant_partner_quest",
                    "category": "food",
                    "is_partner": True,
                    "is_target_category": False,
                    "device_mismatch": False,
                    "multi_account_signal": False,
                    "timestamp": datetime.now(UTC).isoformat(),
                },
            )

        quests = client.get("/quests", params={"user_id": user_id})
        quest = next(item for item in quests.json() if item["quest_id"] == "quest_orbit_001")
        assert quest["status"] == "completed"

        claim = client.post(f"/quests/{quest['quest_id']}/claim", params={"user_id": user_id})
        assert claim.status_code == 200
        assert claim.json()["status"] == "claimed"


def test_risky_event_surfaces_in_admin_risk() -> None:
    user_id = unique_user_id("u_risk")
    with TestClient(app) as client:
        client.post("/auth/demo-login", json={"user_id": user_id, "display_name": "Risk Pilot", "segment": "student"})
        client.post(
            "/admin/simulate",
            json={
                "event_type": "txn_posted",
                "event_id": f"evt_{uuid4().hex[:8]}",
                "user_id": user_id,
                "amount": 900,
                "merchant_id": "merchant_partner_risk",
                "category": "electronics",
                "is_partner": True,
                "is_target_category": True,
                "device_mismatch": True,
                "multi_account_signal": True,
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )

        admin_risk = client.get("/admin/risk")
        assert admin_risk.status_code == 200
        payload = admin_risk.json()
        assert [flag["flag_type"] for flag in payload["active_flags"]] == [
            "device_mismatch",
            "multi_account_signal",
            "limit_pressure",
        ]
        assert all(reward["status"] == "pending" for reward in payload["pending_rewards"])


def test_admin_kpi_returns_demo_payload() -> None:
    with TestClient(app) as client:
        response = client.get("/admin/kpi")

    assert response.status_code == 200
    assert response.json() == {
        "active_users": 12480,
        "activation_rate": 0.9134,
        "partner_share": 0.5821,
        "average_tx_frequency": 18.7,
        "on_time_payment_rate": 0.9642,
        "referral_activation_rate": 0.2384,
        "reward_to_revenue_ratio": 0.3126,
        "k_factor": 0.2384,
        "total_rewards": 184320.0,
        "total_revenue": 589760.0,
        "guardrail_headroom": 140544.0,
    }


def test_mini_game_run_is_persisted_and_summarized() -> None:
    user_id = unique_user_id("u_game")
    with TestClient(app) as client:
        run = client.post(
            "/games/runs",
            json={
                "user_id": user_id,
                "game_code": "halva_snake",
                "planet_code": "ORBIT_COMMERCE",
                "score": 12,
                "base_reward": 36,
                "total_reward": 48,
                "bonus_breakdown": {"streak_bonus": 4, "mastery_bonus": 3, "performance_bonus": 3, "focus_bonus": 2},
                "source_event_id": f"evt_{uuid4().hex[:8]}",
            },
        )
        assert run.status_code == 200
        assert run.json()["run_id"].startswith("run_")

        summary = client.get("/games/summary", params={"user_id": user_id})
        assert summary.status_code == 200
        payload = summary.json()
        assert payload["total_runs"] == 1
        assert payload["total_reward"] == 48
        assert payload["games"][0]["best_score"] == 12


@pytest.mark.parametrize(
    ("game_code", "planet_code"),
    [
        ("moby_bird", "CREDIT_SHIELD"),
        ("cashback_tetris", "ORBIT_COMMERCE"),
        ("moby_jump", "CREDIT_SHIELD"),
        ("fintech_match3", "ORBIT_COMMERCE"),
        ("super_moby_bros", "SOCIAL_RING"),
    ],
)
def test_documented_mini_games_are_accepted(game_code: str, planet_code: str) -> None:
    user_id = unique_user_id("u_doc_game")
    with TestClient(app) as client:
        run = client.post(
            "/games/runs",
            json={
                "user_id": user_id,
                "game_code": game_code,
                "planet_code": planet_code,
                "score": 9,
                "base_reward": 18,
                "total_reward": 24,
                "bonus_breakdown": {},
            },
        )
        assert run.status_code == 200
        assert run.json()["game_code"] == game_code


def test_mini_game_run_rejects_wrong_planet() -> None:
    user_id = unique_user_id("u_game_bad")
    with TestClient(app) as client:
        run = client.post(
            "/games/runs",
            json={
                "user_id": user_id,
                "game_code": "social_ring_signal",
                "planet_code": "ORBIT_COMMERCE",
                "score": 8,
                "base_reward": 10,
                "total_reward": 14,
                "bonus_breakdown": {},
            },
        )
        assert run.status_code == 400


def test_friend_invite_accept_and_activity_flow() -> None:
    requester_id = unique_user_id("u_friend_a")
    target_id = unique_user_id("u_friend_b")

    with TestClient(app) as client:
        client.post("/auth/demo-login", json={"user_id": requester_id, "display_name": "Alice Orbit", "segment": "student"})
        client.post("/auth/demo-login", json={"user_id": target_id, "display_name": "Bob Shield", "segment": "student"})

        invite = client.post(
            "/friends/invite",
            json={"user_id": requester_id, "target_user_id": target_id, "source": "qr"},
        )
        assert invite.status_code == 200
        friendship_id = invite.json()["friendship_id"]
        assert invite.json()["status"] == "pending"

        incoming = client.get("/friends", params={"user_id": target_id})
        assert incoming.status_code == 200
        assert incoming.json()["pending_incoming"][0]["friendship_id"] == friendship_id

        accept = client.post("/friends/accept", json={"user_id": target_id, "friendship_id": friendship_id})
        assert accept.status_code == 200
        assert accept.json()["status"] == "accepted"

        run = client.post(
            "/games/runs",
            json={
                "user_id": target_id,
                "game_code": "social_ring_signal",
                "planet_code": "SOCIAL_RING",
                "score": 14,
                "base_reward": 22,
                "total_reward": 29,
                "bonus_breakdown": {"social_bonus": 7},
            },
        )
        assert run.status_code == 200

        friends = client.get("/friends", params={"user_id": requester_id})
        assert friends.status_code == 200
        assert friends.json()["accepted"][0]["user_id"] == target_id

        activity = client.get("/friends/activity", params={"user_id": requester_id})
        assert activity.status_code == 200
        assert activity.json()[0]["actor_user_id"] == target_id
        assert activity.json()[0]["kind"] == "game_run"


def test_friend_invite_rejects_self_invite() -> None:
    user_id = unique_user_id("u_self")
    with TestClient(app) as client:
        client.post("/auth/demo-login", json={"user_id": user_id, "display_name": "Solo", "segment": "student"})
        invite = client.post("/friends/invite", json={"user_id": user_id, "target_user_id": user_id, "source": "manual"})
        assert invite.status_code == 400
        assert invite.json()["detail"] == "Нельзя пригласить самого себя"


def test_qr_payload_generation_and_resolve_flow() -> None:
    user_id = unique_user_id("u_qr")
    with TestClient(app) as client:
        client.post("/auth/demo-login", json={"user_id": user_id, "display_name": "Qr Pilot", "segment": "student"})

        me = client.get("/qr/me", params={"user_id": user_id})
        assert me.status_code == 200
        payload = me.json()
        assert payload["resolved_type"] == "friend_invite"
        assert payload["valid"] is True
        assert payload["raw_payload"]

        resolved = client.post("/qr/resolve", json={"user_id": user_id, "payload": payload["raw_payload"]})
        assert resolved.status_code == 200
        assert resolved.json()["valid"] is True
        assert resolved.json()["resolved_type"] == "friend_invite"
        assert resolved.json()["cta_kind"] == "add_friend"

        invalid = client.post("/qr/resolve", json={"user_id": user_id, "payload": "not-json"})
        assert invalid.status_code == 200
        assert invalid.json()["valid"] is False
        assert invalid.json()["resolved_type"] == "invalid"


def test_assistant_context_and_chat_flow() -> None:
    user_id = unique_user_id("u_ai")
    with TestClient(app) as client:
        client.post("/auth/demo-login", json={"user_id": user_id, "display_name": "Ai Pilot", "segment": "student"})
        client.post(
            "/admin/simulate",
            json={
                "event_type": "txn_posted",
                "event_id": f"evt_{uuid4().hex[:8]}",
                "user_id": user_id,
                "amount": 75,
                "merchant_id": "merchant_partner_ai",
                "category": "food",
                "is_partner": True,
                "is_target_category": True,
                "device_mismatch": False,
                "multi_account_signal": False,
                "timestamp": datetime.now(UTC).isoformat(),
            },
        )

        context = client.get("/assistant/context", params={"user_id": user_id})
        assert context.status_code == 200
        assert context.json()["user_id"] == user_id
        assert context.json()["recommended_focus"]
        assert "Что делать дальше?" in context.json()["quick_prompts"]

        chat = client.post(
            "/assistant/chat",
            json={"user_id": user_id, "message": "Что делать дальше?"},
        )
        assert chat.status_code == 200
        assert chat.json()["message"]
        assert "quests" in chat.json()["related_modules"]
