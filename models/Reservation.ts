import mongoose from "mongoose";

const reservationSchema = new mongoose.Schema(
  {
    itemId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Item",
      required: true,
    },
    clientId: { type: String, required: true },
    status: {
      type: String,
      enum: ["HELD", "CONFIRMED", "EXPIRED"],
      required: true,
    },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

reservationSchema.index({ itemId: 1, status: 1, expiresAt: 1 });
reservationSchema.index({ clientId: 1, status: 1, expiresAt: 1 });

export default mongoose.model("Reservation", reservationSchema);
