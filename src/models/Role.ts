import mongoose, { Schema, Document } from 'mongoose';

interface IRole extends Document {
  roleId: string;
  roleName: string;
}

const RoleSchema: Schema = new Schema({
  roleId: { type: String, required: true },
  roleName: { type: String, required: true } 
});

const Role = mongoose.model<IRole>('Role', RoleSchema);
export default Role;