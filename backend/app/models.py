from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    primary_character_id: Mapped[int | None] = mapped_column(BigInteger)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")

    # Valuation preferences
    reprocess_yield: Mapped[float] = mapped_column(Float, default=0.85, server_default="0.85")
    price_basis: Mapped[str] = mapped_column(String(8), default="buy", server_default="buy")  # buy | sell

    characters: Mapped[list["Character"]] = relationship(
        back_populates="user", cascade="all, delete-orphan", lazy="selectin", order_by="Character.name"
    )


class Character(Base):
    __tablename__ = "characters"

    character_id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    owner_hash: Mapped[str] = mapped_column(String(255))

    corporation_id: Mapped[int | None] = mapped_column(BigInteger)
    corporation_name: Mapped[str | None] = mapped_column(String(255))
    alliance_id: Mapped[int | None] = mapped_column(BigInteger)
    alliance_name: Mapped[str | None] = mapped_column(String(255))

    refresh_token_enc: Mapped[str] = mapped_column(Text)
    scopes: Mapped[str] = mapped_column(Text, default="")
    token_valid: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")

    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    next_sync_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    last_error: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    user: Mapped[User] = relationship(back_populates="characters")


class LedgerEntry(Base):
    """One row per character/day/system/ore, mirroring ESI's mining ledger.

    ESI only keeps 30 days; this table is the long-term history. The quantity for a
    (date, system, type) is a running daily total, so sync overwrites rather than adds.
    """

    __tablename__ = "mining_ledger"

    character_id: Mapped[int] = mapped_column(
        ForeignKey("characters.character_id", ondelete="CASCADE"), primary_key=True
    )
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    solar_system_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    type_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    quantity: Mapped[int] = mapped_column(BigInteger)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Price(Base):
    """Daily Jita snapshot. Today's row is overwritten on every refresh."""

    __tablename__ = "prices"

    type_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    date: Mapped[date] = mapped_column(Date, primary_key=True)
    buy: Mapped[float] = mapped_column(Float)
    sell: Mapped[float] = mapped_column(Float)


class SdeType(Base):
    __tablename__ = "sde_types"

    type_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(String(255))
    group_id: Mapped[int] = mapped_column(Integer, index=True)
    volume: Mapped[float] = mapped_column(Float)
    portion_size: Mapped[int] = mapped_column(Integer, default=1)
    # asteroid | moon | ice | gas | other
    ore_class: Mapped[str] = mapped_column(String(16), default="other")
    # R4..R64 for moon ore, null otherwise
    moon_rarity: Mapped[int | None] = mapped_column(Integer)


class SdeGroup(Base):
    __tablename__ = "sde_groups"

    group_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(String(255))
    category_id: Mapped[int] = mapped_column(Integer)


class SdeTypeMaterial(Base):
    __tablename__ = "sde_type_materials"

    type_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    material_type_id: Mapped[int] = mapped_column(Integer, primary_key=True)
    quantity: Mapped[int] = mapped_column(Integer)


class SdeSystem(Base):
    __tablename__ = "sde_systems"

    system_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(String(64))
    region_id: Mapped[int] = mapped_column(Integer)
    security: Mapped[float] = mapped_column(Float)


class SdeRegion(Base):
    __tablename__ = "sde_regions"

    region_id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False)
    name: Mapped[str] = mapped_column(String(64))


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
    admin_user_id: Mapped[int] = mapped_column(Integer)
    admin_character_name: Mapped[str | None] = mapped_column(String(255))
    action: Mapped[str] = mapped_column(String(50))
    target_type: Mapped[str] = mapped_column(String(50))
    target_id: Mapped[int | None] = mapped_column(BigInteger)
    details: Mapped[str | None] = mapped_column(Text)
    ip_address: Mapped[str | None] = mapped_column(String(64))
