import mongoose, { Schema } from 'mongoose';
const RoleSchema = new Schema({
    roleId: { type: String, required: true },
    roleName: { type: String, required: true }
});
const Role = mongoose.model('Role', RoleSchema);
export default Role;
