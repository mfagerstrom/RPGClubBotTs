import mongoose, { Schema, Document } from 'mongoose';

interface IPresence extends Document {
  activityName: string;
  timestamp: Date;
}

const PresenceSchema: Schema = new Schema({
  activityName: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const Presence = mongoose.model<IPresence>('Presence', PresenceSchema);
export default Presence;