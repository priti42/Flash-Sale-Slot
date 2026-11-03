import { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import Item from "../models/Item";
import Reservation from "../models/Reservation";
import { HOLD_DURATION_MS, SALE_ITEM_NAME } from "../constants";

class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function getClientId(req: Request): string {
  const header = req.header("x-client-id");
  const clientId = typeof header === "string" ? header.trim() : "";
  if (!clientId) {
    throw new HttpError(400, "Missing X-Client-Id header.", "MISSING_CLIENT_ID");
  }
  return clientId;
}

async function getSaleItem() {
  const item = await Item.findOne({ name: SALE_ITEM_NAME });
  if (!item) {
    throw new HttpError(500, "Sale item is not initialized.", "ITEM_NOT_SEEDED");
  }
  return item;
}

async function expireStaleHolds(itemId: mongoose.Types.ObjectId) {
  const now = new Date();

  while (true) {
    const expired = await Reservation.findOneAndUpdate(
      { itemId, status: "HELD", expiresAt: { $lte: now } },
      { $set: { status: "EXPIRED" } },
    );

    if (!expired) {
      break;
    }

    await Item.updateOne(
      { _id: itemId, heldCount: { $gt: 0 } },
      { $inc: { heldCount: -1 } },
    );
  }
}

async function computeInventory(itemId: mongoose.Types.ObjectId, totalCapacity: number) {
  const now = new Date();
  const [confirmedCount, activeHolds] = await Promise.all([
    Reservation.countDocuments({ itemId, status: "CONFIRMED" }),
    Reservation.countDocuments({
      itemId,
      status: "HELD",
      expiresAt: { $gt: now },
    }),
  ]);

  return {
    totalCapacity,
    confirmedCount,
    activeHolds,
    availableStock: totalCapacity - confirmedCount - activeHolds,
  };
}

function serializeReservation(reservation: {
  _id: mongoose.Types.ObjectId;
  status: string;
  expiresAt: Date;
}) {
  return {
    reservationId: reservation._id.toString(),
    status: reservation.status,
    expiresAt: reservation.expiresAt.toISOString(),
  };
}

export async function getInventory(_req: Request, res: Response, next: NextFunction) {
  try {
    const item = await getSaleItem();
    await expireStaleHolds(item._id);
    const inventory = await computeInventory(item._id, item.totalCapacity);

    res.json({ success: true, data: inventory });
  } catch (error) {
    next(error);
  }
}

export async function getMyReservation(req: Request, res: Response, next: NextFunction) {
  try {
    const clientId = getClientId(req);
    const item = await getSaleItem();
    await expireStaleHolds(item._id);

    const reservation = await Reservation.findOne({
      itemId: item._id,
      clientId,
      status: "HELD",
      expiresAt: { $gt: new Date() },
    });

    res.json({
      success: true,
      data: reservation ? serializeReservation(reservation) : null,
    });
  } catch (error) {
    next(error);
  }
}

export async function reserveSlot(req: Request, res: Response, next: NextFunction) {
  try {
    const clientId = getClientId(req);
    const item = await getSaleItem();
    await expireStaleHolds(item._id);

    const existingHold = await Reservation.findOne({
      itemId: item._id,
      clientId,
      status: "HELD",
      expiresAt: { $gt: new Date() },
    });

    if (existingHold) {
      res.status(200).json({
        success: true,
        data: serializeReservation(existingHold),
      });
      return;
    }

    const claimed = await Item.findOneAndUpdate(
      {
        _id: item._id,
        $expr: {
          $lt: [{ $add: ["$heldCount", "$confirmedCount"] }, "$totalCapacity"],
        },
      },
      { $inc: { heldCount: 1 } },
      { new: true },
    );

    if (!claimed) {
      throw new HttpError(
        409,
        "Sorry! All slots are currently reserved.",
        "SOLD_OUT",
      );
    }

    try {
      const reservation = await Reservation.create({
        itemId: item._id,
        clientId,
        status: "HELD",
        expiresAt: new Date(Date.now() + HOLD_DURATION_MS),
      });

      res.status(201).json({
        success: true,
        data: serializeReservation(reservation),
      });
    } catch (createError) {
      await Item.updateOne(
        { _id: item._id, heldCount: { $gt: 0 } },
        { $inc: { heldCount: -1 } },
      );
      throw createError;
    }
  } catch (error) {
    next(error);
  }
}

export async function confirmReservation(req: Request, res: Response, next: NextFunction) {
  try {
    const { reservationId } = req.body ?? {};

    if (!reservationId || typeof reservationId !== "string") {
      throw new HttpError(400, "reservationId is required.", "INVALID_RESERVATION_ID");
    }

    if (!mongoose.Types.ObjectId.isValid(reservationId)) {
      throw new HttpError(400, "Invalid reservation ID.", "INVALID_RESERVATION_ID");
    }

    const item = await getSaleItem();
    await expireStaleHolds(item._id);

    const now = new Date();
    const confirmed = await Reservation.findOneAndUpdate(
      {
        _id: reservationId,
        status: "HELD",
        expiresAt: { $gt: now },
      },
      { $set: { status: "CONFIRMED" } },
      { new: true },
    );

    if (confirmed) {
      await Item.updateOne(
        { _id: confirmed.itemId, heldCount: { $gt: 0 } },
        { $inc: { heldCount: -1, confirmedCount: 1 } },
      );

      res.json({
        success: true,
        data: {
          message: "Reservation Confirmed",
          ...serializeReservation(confirmed),
        },
      });
      return;
    }

    const existing = await Reservation.findById(reservationId);

    if (!existing) {
      throw new HttpError(404, "Reservation not found.", "NOT_FOUND");
    }

    if (existing.status === "CONFIRMED") {
      throw new HttpError(
        409,
        "Reservation is already confirmed.",
        "ALREADY_CONFIRMED",
      );
    }

    if (existing.status === "HELD") {
      const flipped = await Reservation.findOneAndUpdate(
        { _id: existing._id, status: "HELD" },
        { $set: { status: "EXPIRED" } },
      );

      if (flipped) {
        await Item.updateOne(
          { _id: existing.itemId, heldCount: { $gt: 0 } },
          { $inc: { heldCount: -1 } },
        );
      }
    }

    throw new HttpError(410, "Reservation has expired.", "EXPIRED");
  } catch (error) {
    next(error);
  }
}

export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof HttpError) {
    res.status(err.status).json({
      success: false,
      error: { code: err.code, message: err.message },
    });
    return;
  }

  console.error(err);
  res.status(500).json({
    success: false,
    error: { code: "INTERNAL_ERROR", message: "A database or server error occurred." },
  });
}
