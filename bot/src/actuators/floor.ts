// The floor under andy (the old mine.js dropBelow and floorDrop): never dig the block andy stands on when there
// is a drop of more than MAX_SAFE_DROP under it (a cave under a stone or ore floor). Pure; they live with the mine
// model's geometry (5.2) and are re-exported here for the actuators.
export { dropBelow, floorDrop, hollowUnder, MAX_SAFE_DROP, type BoxAt } from '../models/mine/geometry.js';
