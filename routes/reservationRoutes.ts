import { Router } from "express";
import {
  confirmReservation,
  getInventory,
  getMyReservation,
  reserveSlot,
} from "../controllers/reservationController";

const router = Router();

router.get("/inventory", getInventory);
router.get("/reservation/me", getMyReservation);
router.post("/reserve", reserveSlot);
router.post("/confirm", confirmReservation);

export default router;
