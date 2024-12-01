import mongoose, { Schema, Document } from 'mongoose';

interface IUser {
  username: string;
  globalName: string;
  avatar: string | null;
}

interface IMember extends Document {
  id: string;
  joinedTimestamp: Date | null;
  partedTimestamp?: Date | null;
  nickname: string | null;
  user: IUser;
  roleIds: string[];
}

// models/Member.ts
const UserSchema: Schema = new Schema({
  username: { type: String, required: true },
  globalName: { type: String, required: true, default: 'Unknown' },
  avatar: { type: String, required: false }
});

const MemberSchema: Schema = new Schema({
  id: { type: String, required: true },
  joinedTimestamp: { type: Date, required: false },
  partedTimestamp: { type: Date, required: false },
  nickname: { type: String, required: false },
  user: { type: UserSchema, required: true },
  roleIds: [{ type: String, required: true }]
});

const Member = mongoose.model<IMember>('Member', MemberSchema);
export default Member;