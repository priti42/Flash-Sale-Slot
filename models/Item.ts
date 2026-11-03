import mongoose from "mongoose";
import { DEFAULT_CAPACITY } from "../constants";

const itemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, unique: true },
    totalCapacity: { type: Number, required: true, default: DEFAULT_CAPACITY, min: 0 },
    heldCount: { type: Number, required: true, default: 0, min: 0 },
    confirmedCount: { type: Number, required: true, default: 0, min: 0 },
  },
  { timestamps: true },
);

export default mongoose.model("Item", itemSchema);
