from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import desc, func, or_, select
from sqlalchemy.orm import Session

from app.analytics import build_admin_risk_response, build_demo_admin_kpis
from app.bootstrap import ensure_user
from app.core.config import get_settings
from app.db import get_session
from app.models import EventLog, Friendship, GameRun, Quest, QuestProgress, Referral, RewardLedger, User
from app.queue import enqueue_event
from app.schemas import (
    AdminKpiResponse,
    AdminRiskResponse,
    AssistantChatRequest,
    AssistantChatResponse,
    AssistantContextResponse,
    DemoLoginRequest,
    DemoSessionResponse,
    EventPayload,
    FriendAcceptRequest,
    FriendActivityEntry,
    FriendEntry,
    FriendInviteRequest,
    FriendsResponse,
    GalaxyProfileResponse,
    GameRunCreate,
    GameRunOut,
    GameSummaryItem,
    GameSummaryResponse,
    IngestResponse,
    LeaderboardEntry,
    QuestClaimResponse,
    QuestOut,
    QrResolveRequest,
    QrResolvedPayload,
    ReferralInviteRequest,
    ReferralOut,
    RewardLedgerOut,
)

router = APIRouter()

GAME_PLANETS = {
    "halva_snake": "ORBIT_COMMERCE",
    "credit_shield_reactor": "CREDIT_SHIELD",
    "social_ring_signal": "SOCIAL_RING",
    "moby_bird": "CREDIT_SHIELD",
    "cashback_tetris": "ORBIT_COMMERCE",
    "moby_jump": "CREDIT_SHIELD",
    "fintech_match3": "ORBIT_COMMERCE",
    "super_moby_bros": "SOCIAL_RING",
}

ASSISTANT_PROMPTS = [
    "Что делать дальше?",
    "Какой квест ближе всего к завершению?",
    "Какая планета проседает?",
    "Объясни этот QR-код.",
    "Как лучше использовать друзей и рефералов?",
    "Почему появился риск-сигнал?",
]


def build_profile(session: Session, user_id: str) -> GalaxyProfileResponse:
    user = session.get(User, user_id)
    if user is None:
        raise HTTPException(status_code=404, detail="Пользователь не найден")

    from app.models import BoosterWindow, InstallmentProfile, OrbitState, PlanetProgress

    orbit_state = session.get(OrbitState, user_id)
    installment = session.get(InstallmentProfile, user_id)
    progress_items = session.scalars(select(PlanetProgress).where(PlanetProgress.user_id == user_id)).all()
    boosters = session.scalars(
        select(BoosterWindow)
        .where(BoosterWindow.user_id == user_id, BoosterWindow.status == "active")
        .order_by(desc(BoosterWindow.end_at))
    ).all()
    unique_boosters: list[BoosterWindow] = []
    seen_booster_categories: set[str] = set()
    for booster in boosters:
        if booster.category in seen_booster_categories:
            continue
        seen_booster_categories.add(booster.category)
        unique_boosters.append(booster)
    quest_rows = session.execute(
        select(Quest, QuestProgress)
        .join(QuestProgress, Quest.quest_id == QuestProgress.quest_id)
        .where(QuestProgress.user_id == user_id, Quest.active.is_(True))
    ).all()

    partner_spend = 0.0
    total_spend = 0.0
    for event in session.scalars(select(EventLog).where(EventLog.user_id == user_id, EventLog.event_type == "txn_posted")).all():
        amount = float(event.payload["amount"])
        total_spend += amount
        if event.payload.get("is_partner"):
            partner_spend += amount

    return GalaxyProfileResponse(
        user_id=user.user_id,
        display_name=user.display_name,
        orbit_level=orbit_state.orbit_level,
        total_energy=orbit_state.total_energy,
        total_xp=orbit_state.total_xp,
        partner_share=round(partner_spend / total_spend, 4) if total_spend else 0.0,
        planets=[
            {"planet_code": item.planet_code, "xp": item.xp, "level": item.level}
            for item in sorted(progress_items, key=lambda value: value.planet_code)
        ],
        active_boosters=[
            {
                "booster_id": item.booster_id,
                "category": item.category,
                "boost_rate": item.boost_rate,
                "start_at": item.start_at,
                "end_at": item.end_at,
                "status": item.status,
            }
            for item in unique_boosters
        ],
        quests=[
            QuestOut(
                quest_id=quest.quest_id,
                title=quest.title,
                description=quest.description,
                planet_code=quest.planet_code,
                condition_type=quest.condition_type,
                threshold=quest.threshold,
                reward_kind=quest.reward_kind,
                reward_value=quest.reward_value,
                status=progress.status,
                current_value=progress.current_value,
            )
            for quest, progress in quest_rows
        ],
        installment_profile={
            "current_limit": installment.current_limit,
            "available_limit": installment.available_limit,
            "risk_score": installment.risk_score,
            "on_time_payments_3m": installment.on_time_payments_3m,
            "late_flags": installment.late_flags,
        },
    )


def find_existing_friendship(session: Session, left_user_id: str, right_user_id: str) -> Friendship | None:
    return session.scalar(
        select(Friendship).where(
            or_(
                (Friendship.requester_user_id == left_user_id) & (Friendship.target_user_id == right_user_id),
                (Friendship.requester_user_id == right_user_id) & (Friendship.target_user_id == left_user_id),
            )
        )
    )


def build_friend_entry(session: Session, friendship: Friendship, current_user_id: str) -> FriendEntry:
    other_user_id = friendship.target_user_id if friendship.requester_user_id == current_user_id else friendship.requester_user_id
    other_user = session.get(User, other_user_id)
    return FriendEntry(
        friendship_id=friendship.friendship_id,
        user_id=other_user_id,
        display_name=other_user.display_name if other_user else other_user_id,
        status=friendship.status,
        source=friendship.source,
        created_at=friendship.created_at,
        accepted_at=friendship.accepted_at,
    )


def get_friend_user_ids(session: Session, user_id: str) -> list[str]:
    friendships = session.scalars(
        select(Friendship).where(
            Friendship.status == "accepted",
            or_(Friendship.requester_user_id == user_id, Friendship.target_user_id == user_id),
        )
    ).all()
    return [
        friendship.target_user_id if friendship.requester_user_id == user_id else friendship.requester_user_id
        for friendship in friendships
    ]


def count_pending_incoming(session: Session, user_id: str) -> int:
    return session.scalar(
        select(func.count()).select_from(Friendship).where(Friendship.target_user_id == user_id, Friendship.status == "pending")
    ) or 0


def build_qr_payload(user_id: str, payload_type: str = "friend_invite", meta: dict | None = None) -> str:
    return json.dumps(
        {
            "type": payload_type,
            "version": 1,
            "issued_for_user_id": user_id,
            "source": "mtb_galaxy",
            "meta": meta or {"label": "Добавить друга в MTB Galaxy"},
        },
        ensure_ascii=False,
        separators=(",", ":"),
    )


def resolve_qr_payload(raw_payload: str) -> QrResolvedPayload:
    try:
        payload = json.loads(raw_payload)
    except json.JSONDecodeError:
        return QrResolvedPayload(
            valid=False,
            resolved_type="invalid",
            title="QR-код не распознан",
            description="Строка не похожа на валидный MTB payload.",
            cta_kind="none",
            cta_target=None,
            raw_payload=raw_payload,
        )

    if not isinstance(payload, dict) or not payload.get("type") or not payload.get("issued_for_user_id"):
        return QrResolvedPayload(
            valid=False,
            resolved_type="invalid",
            title="QR-код не распознан",
            description="В payload отсутствуют обязательные поля.",
            cta_kind="none",
            cta_target=None,
            raw_payload=raw_payload,
        )

    resolved_type = str(payload["type"])
    target_user_id = str(payload["issued_for_user_id"])
    title = "MTB QR-код"
    description = "Код распознан."
    cta_kind = "none"
    if resolved_type == "friend_invite":
        title = "Приглашение в друзья"
        description = f"Пользователь {target_user_id} предлагает добавить его в друзья."
        cta_kind = "add_friend"
    elif resolved_type == "referral_invite":
        title = "Реферальный QR"
        description = f"Код ведет в реферальный сценарий пользователя {target_user_id}."
        cta_kind = "open_referral"
    elif resolved_type == "deep_link_action":
        title = "Быстрое действие"
        description = "QR-код ведет к действию внутри приложения."
        cta_kind = "navigate"
    elif resolved_type == "ai_context":
        title = "AI-контекст"
        description = "QR-код содержит контекст для ассистента."
        cta_kind = "ask_assistant"

    return QrResolvedPayload(
        valid=True,
        resolved_type=resolved_type,
        title=title,
        description=description,
        cta_kind=cta_kind,
        cta_target=target_user_id,
        raw_payload=raw_payload,
    )


def build_assistant_context(session: Session, user_id: str) -> AssistantContextResponse:
    profile = build_profile(session, user_id)
    friend_count = len(get_friend_user_ids(session, user_id))
    pending_invites_count = count_pending_incoming(session, user_id)
    weakest_planet = min(profile.planets, key=lambda planet: (planet.level, planet.xp))
    active_quests = [quest for quest in profile.quests if quest.status == "active"]

    summary_chips = [
        f"Уровень орбиты: {profile.orbit_level}",
        f"Активных квестов: {len(active_quests)}",
        f"Друзей: {friend_count}",
    ]
    if pending_invites_count:
        summary_chips.append(f"Новых приглашений: {pending_invites_count}")

    return AssistantContextResponse(
        user_id=user_id,
        recommended_focus=weakest_planet.planet_code,
        quick_prompts=ASSISTANT_PROMPTS,
        summary_chips=summary_chips,
        friend_count=friend_count,
        pending_invites_count=pending_invites_count,
    )


def build_assistant_reply(
    session: Session,
    user_id: str,
    message: str,
    qr_payload: str | None = None,
) -> AssistantChatResponse:
    context = build_assistant_context(session, user_id)
    profile = build_profile(session, user_id)
    normalized_message = message.lower()
    if qr_payload:
        resolved = resolve_qr_payload(qr_payload)
        return AssistantChatResponse(
            message=f"{resolved.title}. {resolved.description}",
            suggested_actions=["Открыть QR-раздел", "Продолжить действие по коду"],
            related_modules=["qr", "friends", "quests"],
            context_chips=context.summary_chips,
        )

    active_quests = [quest for quest in profile.quests if quest.status == "active"]
    nearest_quest = min(
        active_quests,
        key=lambda quest: max(0.0, quest.threshold - quest.current_value),
        default=None,
    )
    weakest_planet = min(profile.planets, key=lambda planet: (planet.level, planet.xp))

    if "квест" in normalized_message or "quest" in normalized_message:
        if nearest_quest is None:
            text = "Сейчас нет активных квестов, которые требуют следующего шага."
        else:
            remaining = max(0.0, nearest_quest.threshold - nearest_quest.current_value)
            text = f"Ближе всего к завершению квест «{nearest_quest.title}». До цели осталось {remaining:g}."
        return AssistantChatResponse(
            message=text,
            suggested_actions=["Открыть квесты", "Запустить подходящую игру"],
            related_modules=["quests", "games"],
            context_chips=context.summary_chips,
        )

    if "qr" in normalized_message:
        return AssistantChatResponse(
            message="QR-раздел поможет показать ваш персональный код, принять чужой payload и сразу понять, что с ним делать дальше.",
            suggested_actions=["Открыть QR", "Показать мой код"],
            related_modules=["qr", "friends"],
            context_chips=context.summary_chips,
        )

    if "друг" in normalized_message or "friend" in normalized_message or "рефера" in normalized_message:
        return AssistantChatResponse(
            message=f"У вас уже {context.friend_count} подтвержденных друзей. Следующий рост даст связка друзей, QR и социального кольца.",
            suggested_actions=["Открыть друзей", "Создать QR-приглашение"],
            related_modules=["friends", "qr", "referrals"],
            context_chips=context.summary_chips,
        )

    if "риск" in normalized_message:
        return AssistantChatResponse(
            message="Риск-сигналы обычно появляются из-за необычных устройств, высокой скорости операций или нетипичной суммы. Их стоит сверять через админ-контур и историю событий.",
            suggested_actions=["Открыть риски", "Проверить последние события"],
            related_modules=["admin", "rewards"],
            context_chips=context.summary_chips,
        )

    return AssistantChatResponse(
        message=f"Следующий полезный шаг — усилить планету {weakest_planet.planet_code} и добрать ближайший квест. После этого можно расширить социальный прогресс через друзей или QR.",
        suggested_actions=["Открыть квесты", "Открыть игры", "Открыть друзей"],
        related_modules=["quests", "games", "friends"],
        context_chips=context.summary_chips,
    )


@router.post("/auth/demo-login", response_model=DemoSessionResponse)
def demo_login(payload: DemoLoginRequest, session: Session = Depends(get_session)) -> DemoSessionResponse:
    ensure_user(session, payload.user_id, payload.display_name, payload.segment)
    return DemoSessionResponse(user_id=payload.user_id, token=f"demo-{payload.user_id}")


@router.get("/galaxy/profile", response_model=GalaxyProfileResponse)
def galaxy_profile(user_id: str, session: Session = Depends(get_session)) -> GalaxyProfileResponse:
    return build_profile(session, user_id)


@router.post("/events/ingest", response_model=IngestResponse)
def ingest_event(payload: EventPayload, session: Session = Depends(get_session)) -> IngestResponse:
    ensure_user(session, payload.user_id)
    event = EventLog(
        event_id=payload.event_id,
        user_id=payload.user_id,
        event_type=payload.event_type,
        payload=payload.model_dump(mode="json", exclude={"event_type"}),
    )
    session.add(event)
    session.commit()
    status = enqueue_event(session, payload.event_id)
    return IngestResponse(event_id=payload.event_id, status=status)


@router.get("/quests", response_model=list[QuestOut])
def get_quests(user_id: str, session: Session = Depends(get_session)) -> list[QuestOut]:
    return build_profile(session, user_id).quests


@router.post("/quests/{quest_id}/claim", response_model=QuestClaimResponse)
def claim_quest(quest_id: str, user_id: str, session: Session = Depends(get_session)) -> QuestClaimResponse:
    progress = session.scalar(
        select(QuestProgress).where(QuestProgress.user_id == user_id, QuestProgress.quest_id == quest_id)
    )
    quest = session.get(Quest, quest_id)
    if progress is None or quest is None:
        raise HTTPException(status_code=404, detail="Квест не найден")
    if progress.status != "completed":
        raise HTTPException(status_code=400, detail="Квест еще не готов к получению награды")

    progress.status = "claimed"
    progress.claimed_at = datetime.now(UTC).replace(tzinfo=None)
    ledger = RewardLedger(
        user_id=user_id,
        source_event_id=None,
        reward_type=f"quest_{quest.reward_kind}",
        amount=quest.reward_value,
        status="confirmed",
        meta={"quest_id": quest_id},
    )
    session.add(ledger)
    session.commit()
    session.refresh(ledger)
    return QuestClaimResponse(quest_id=quest_id, status="claimed", ledger_id=ledger.ledger_id)


@router.get("/rewards/ledger", response_model=list[RewardLedgerOut])
def reward_ledger(user_id: str, session: Session = Depends(get_session)) -> list[RewardLedgerOut]:
    rows = session.scalars(
        select(RewardLedger).where(RewardLedger.user_id == user_id).order_by(desc(RewardLedger.created_at))
    ).all()
    return [RewardLedgerOut.model_validate(row, from_attributes=True) for row in rows]


@router.post("/games/runs", response_model=GameRunOut)
def create_game_run(payload: GameRunCreate, session: Session = Depends(get_session)) -> GameRunOut:
    ensure_user(session, payload.user_id)
    expected_planet = GAME_PLANETS[payload.game_code]
    if payload.planet_code != expected_planet:
        raise HTTPException(status_code=400, detail=f"Игра {payload.game_code} должна быть привязана к планете {expected_planet}")

    run = GameRun(
        user_id=payload.user_id,
        game_code=payload.game_code,
        planet_code=payload.planet_code,
        score=payload.score,
        base_reward=payload.base_reward,
        total_reward=payload.total_reward,
        bonus_breakdown=payload.bonus_breakdown,
        source_event_id=payload.source_event_id,
    )
    session.add(run)
    session.add(
        RewardLedger(
            user_id=payload.user_id,
            source_event_id=payload.source_event_id,
            reward_type="mini_game_stardust",
            amount=0,
            status="confirmed",
            meta={
                "game_code": payload.game_code,
                "planet_code": payload.planet_code,
                "score": payload.score,
                "base_reward": payload.base_reward,
                "stardust_awarded": payload.total_reward,
                "bonus_breakdown": payload.bonus_breakdown,
            },
        )
    )
    session.commit()
    session.refresh(run)
    return GameRunOut.model_validate(run, from_attributes=True)


@router.get("/games/summary", response_model=GameSummaryResponse)
def game_summary(user_id: str, session: Session = Depends(get_session)) -> GameSummaryResponse:
    ensure_user(session, user_id)
    rows = session.execute(
        select(
            GameRun.game_code,
            GameRun.planet_code,
            func.count(GameRun.run_id),
            func.max(GameRun.score),
            func.coalesce(func.sum(GameRun.total_reward), 0),
        )
        .where(GameRun.user_id == user_id)
        .group_by(GameRun.game_code, GameRun.planet_code)
    ).all()
    games = [
        GameSummaryItem(
            game_code=game_code,
            planet_code=planet_code,
            runs=int(runs),
            best_score=int(best_score or 0),
            total_reward=int(total_reward or 0),
        )
        for game_code, planet_code, runs, best_score, total_reward in rows
    ]
    return GameSummaryResponse(
        user_id=user_id,
        total_runs=sum(item.runs for item in games),
        total_reward=sum(item.total_reward for item in games),
        games=games,
    )


@router.post("/referrals/invite", response_model=ReferralOut)
def create_referral(payload: ReferralInviteRequest, user_id: str, session: Session = Depends(get_session)) -> ReferralOut:
    ensure_user(session, user_id)
    referral = Referral(inviter_id=user_id, invitee_id=payload.invitee_id)
    session.add(referral)
    session.commit()
    session.refresh(referral)
    return ReferralOut.model_validate(referral, from_attributes=True)


@router.get("/friends", response_model=FriendsResponse)
def get_friends(user_id: str, session: Session = Depends(get_session)) -> FriendsResponse:
    ensure_user(session, user_id)
    friendships = session.scalars(
        select(Friendship)
        .where(or_(Friendship.requester_user_id == user_id, Friendship.target_user_id == user_id))
        .order_by(desc(Friendship.created_at))
    ).all()
    accepted = [build_friend_entry(session, friendship, user_id) for friendship in friendships if friendship.status == "accepted"]
    pending_incoming = [
        build_friend_entry(session, friendship, user_id)
        for friendship in friendships
        if friendship.status == "pending" and friendship.target_user_id == user_id
    ]
    pending_outgoing = [
        build_friend_entry(session, friendship, user_id)
        for friendship in friendships
        if friendship.status == "pending" and friendship.requester_user_id == user_id
    ]
    return FriendsResponse(accepted=accepted, pending_incoming=pending_incoming, pending_outgoing=pending_outgoing)


@router.post("/friends/invite", response_model=FriendEntry)
def invite_friend(payload: FriendInviteRequest, session: Session = Depends(get_session)) -> FriendEntry:
    ensure_user(session, payload.user_id)
    ensure_user(session, payload.target_user_id, display_name=f"Пилот {payload.target_user_id[-4:]}")
    if payload.user_id == payload.target_user_id:
        raise HTTPException(status_code=400, detail="Нельзя пригласить самого себя")

    existing = find_existing_friendship(session, payload.user_id, payload.target_user_id)
    if existing is not None:
        raise HTTPException(status_code=400, detail="Связь между пользователями уже существует")

    friendship = Friendship(
        requester_user_id=payload.user_id,
        target_user_id=payload.target_user_id,
        source=payload.source,
        status="pending",
    )
    session.add(friendship)
    session.commit()
    session.refresh(friendship)
    return build_friend_entry(session, friendship, payload.user_id)


@router.post("/friends/accept", response_model=FriendEntry)
def accept_friend(payload: FriendAcceptRequest, session: Session = Depends(get_session)) -> FriendEntry:
    ensure_user(session, payload.user_id)
    friendship = session.get(Friendship, payload.friendship_id)
    if friendship is None:
        raise HTTPException(status_code=404, detail="Приглашение не найдено")
    if friendship.target_user_id != payload.user_id:
        raise HTTPException(status_code=403, detail="Нельзя принять чужое приглашение")
    if friendship.status != "pending":
        raise HTTPException(status_code=400, detail="Приглашение уже обработано")

    friendship.status = "accepted"
    friendship.accepted_at = datetime.now(UTC).replace(tzinfo=None)
    session.commit()
    session.refresh(friendship)
    return build_friend_entry(session, friendship, payload.user_id)


@router.get("/friends/activity", response_model=list[FriendActivityEntry])
def friend_activity(user_id: str, session: Session = Depends(get_session)) -> list[FriendActivityEntry]:
    ensure_user(session, user_id)
    friend_ids = get_friend_user_ids(session, user_id)
    if not friend_ids:
        return []

    activities: list[FriendActivityEntry] = []
    game_runs = session.scalars(
        select(GameRun).where(GameRun.user_id.in_(friend_ids)).order_by(desc(GameRun.created_at)).limit(6)
    ).all()
    for run in game_runs:
        actor = session.get(User, run.user_id)
        activities.append(
            FriendActivityEntry(
                activity_id=run.run_id,
                actor_user_id=run.user_id,
                actor_display_name=actor.display_name if actor else run.user_id,
                kind="game_run",
                title="Друг завершил игровой забег",
                detail=f"{run.game_code} принес {run.total_reward} единиц награды.",
                created_at=run.created_at,
            )
        )

    rewards = session.scalars(
        select(RewardLedger).where(RewardLedger.user_id.in_(friend_ids)).order_by(desc(RewardLedger.created_at)).limit(4)
    ).all()
    for reward in rewards:
        actor = session.get(User, reward.user_id)
        activities.append(
            FriendActivityEntry(
                activity_id=reward.ledger_id,
                actor_user_id=reward.user_id,
                actor_display_name=actor.display_name if actor else reward.user_id,
                kind="reward",
                title="Друг получил награду",
                detail=f"{reward.reward_type}: {reward.amount:g}.",
                created_at=reward.created_at,
            )
        )

    activity_priority = {"game_run": 2, "reward": 1}
    activities.sort(key=lambda item: (activity_priority.get(item.kind, 0), item.created_at), reverse=True)
    return activities[:8]


@router.get("/qr/me", response_model=QrResolvedPayload)
def get_my_qr(user_id: str, session: Session = Depends(get_session)) -> QrResolvedPayload:
    ensure_user(session, user_id)
    raw_payload = build_qr_payload(user_id)
    return resolve_qr_payload(raw_payload)


@router.post("/qr/resolve", response_model=QrResolvedPayload)
def resolve_qr(payload: QrResolveRequest, session: Session = Depends(get_session)) -> QrResolvedPayload:
    ensure_user(session, payload.user_id)
    return resolve_qr_payload(payload.payload)


@router.get("/assistant/context", response_model=AssistantContextResponse)
def assistant_context(user_id: str, session: Session = Depends(get_session)) -> AssistantContextResponse:
    ensure_user(session, user_id)
    return build_assistant_context(session, user_id)


@router.post("/assistant/chat", response_model=AssistantChatResponse)
def assistant_chat(payload: AssistantChatRequest, session: Session = Depends(get_session)) -> AssistantChatResponse:
    ensure_user(session, payload.user_id)
    return build_assistant_reply(session, payload.user_id, payload.message, payload.qr_payload)


@router.get("/leaderboard", response_model=list[LeaderboardEntry])
def leaderboard(session: Session = Depends(get_session)) -> list[LeaderboardEntry]:
    from app.models import OrbitState

    rows = session.execute(
        select(User, OrbitState)
        .join(OrbitState, User.user_id == OrbitState.user_id)
        .order_by(desc(OrbitState.total_xp))
        .limit(10)
    ).all()
    return [
        LeaderboardEntry(
            user_id=user.user_id,
            display_name=user.display_name,
            orbit_level=orbit.orbit_level,
            total_xp=orbit.total_xp,
        )
        for user, orbit in rows
    ]


@router.get("/admin/kpi", response_model=AdminKpiResponse)
def admin_kpi() -> AdminKpiResponse:
    return AdminKpiResponse(**build_demo_admin_kpis())


@router.post("/admin/simulate", response_model=IngestResponse)
def admin_simulate(payload: EventPayload, session: Session = Depends(get_session)) -> IngestResponse:
    return ingest_event(payload, session)


@router.get("/admin/risk", response_model=AdminRiskResponse)
def admin_risk(session: Session = Depends(get_session)) -> AdminRiskResponse:
    return build_admin_risk_response(session)


@router.get("/admin/stream")
async def admin_stream() -> StreamingResponse:
    settings = get_settings()

    async def event_generator():
        while True:
            payload = build_demo_admin_kpis()
            yield f"data: {json.dumps(payload)}\n\n"
            await asyncio.sleep(settings.sse_interval_seconds)

    return StreamingResponse(event_generator(), media_type="text/event-stream")
