import { describe, expect, it } from "vitest";
import { headOf } from "@/lib/tracking/autoReframe";

// Pose landmarks ([x, y, visibility] for the model's 33 points) recorded from a wide stand-up shot.
const lm = (rows: number[][]) => rows.map(([x, y, visibility]) => ({ x, y, visibility }));
/** Facing the camera: the skeleton is the right way up. */
const FACING = lm([[0.504, 0.162, 1], [0.514, 0.134, 1], [0.519, 0.133, 1], [0.525, 0.135, 1], [0.501, 0.137, 1], [0.496, 0.138, 1], [0.489, 0.136, 1], [0.536, 0.148, 1], [0.483, 0.145, 1], [0.515, 0.189, 1], [0.497, 0.184, 1], [0.559, 0.269, 1], [0.437, 0.273, 1], [0.588, 0.42, 0.9], [0.405, 0.474, 0.93], [0.547, 0.356, 0.95], [0.384, 0.647, 0.71], [0.545, 0.345, 0.94], [0.372, 0.699, 0.57], [0.531, 0.322, 0.93], [0.382, 0.707, 0.6], [0.532, 0.322, 0.92], [0.385, 0.688, 0.63], [0.557, 0.562, 1], [0.495, 0.571, 1], [0.54, 0.786, 0.59], [0.491, 0.785, 0.43], [0.514, 0.971, 0.58], [0.48, 0.956, 0.63], [0.509, 0.999, 0.54], [0.481, 0.983, 0.55], [0.505, 1.064, 0.64], [0.476, 1.027, 0.68]]);
/** Two seconds later he has turned away, and the model lays the skeleton over him upside down: "nose" at his knees, "ankles" at his head. */
const TURNED_AWAY = lm([[0.472, 0.73, 0.99], [0.476, 0.743, 0.99], [0.476, 0.745, 0.99], [0.476, 0.747, 0.99], [0.476, 0.738, 1], [0.475, 0.737, 1], [0.475, 0.735, 1], [0.473, 0.744, 0.99], [0.472, 0.728, 0.99], [0.467, 0.723, 0.99], [0.466, 0.717, 0.99], [0.452, 0.697, 1], [0.454, 0.682, 1], [0.452, 0.737, 0.74], [0.441, 0.69, 0.66], [0.48, 0.827, 0.85], [0.456, 0.778, 0.55], [0.49, 0.844, 0.82], [0.456, 0.796, 0.53], [0.49, 0.853, 0.81], [0.463, 0.803, 0.51], [0.485, 0.848, 0.8], [0.463, 0.797, 0.49], [0.436, 0.454, 1], [0.443, 0.464, 1], [0.464, 0.29, 0.35], [0.473, 0.307, 0.7], [0.524, 0.212, 0.31], [0.529, 0.233, 0.64], [0.531, 0.207, 0.6], [0.534, 0.232, 0.79], [0.54, 0.175, 0.39], [0.548, 0.192, 0.66]]);
/** Someone in the audience at the bottom edge of the picture, the right way up. */
const AUDIENCE = lm([[0.25, 0.776, 1], [0.264, 0.727, 1], [0.265, 0.725, 1], [0.266, 0.723, 1], [0.243, 0.73, 1], [0.239, 0.739, 1], [0.232, 0.735, 1], [0.264, 0.718, 1], [0.208, 0.71, 1], [0.246, 0.785, 1], [0.225, 0.78, 1], [0.246, 0.741, 1], [0.112, 0.768, 1], [0.304, 0.859, 0.4], [0.106, 0.926, 0.92], [0.29, 0.888, 0.12], [0.16, 0.898, 0.49], [0.283, 0.909, 0.1], [0.174, 0.904, 0.43], [0.282, 0.89, 0.11], [0.176, 0.87, 0.46], [0.28, 0.886, 0.12], [0.172, 0.869, 0.44], [0.219, 1.009, 0.95], [0.142, 1.05, 0.93], [0.352, 1.116, 0.18], [0.27, 1.175, 0.74], [0.288, 1.333, 0.06], [0.232, 1.405, 0.28], [0.267, 1.345, 0.05], [0.217, 1.424, 0.17], [0.304, 1.428, 0.06], [0.254, 1.49, 0.29]]);

describe("headOf (where the head is, from pose landmarks)", () => {
  it("uses the nose when the skeleton is the right way up", () => {
    const head = headOf(FACING)!;
    expect(head.x).toBeCloseTo(FACING[0].x, 6);
    expect(head.y).toBeCloseTo(FACING[0].y, 6);
  });

  it("puts the head at the top of the outline when the skeleton is upside down", () => {
    const head = headOf(TURNED_AWAY)!;
    // The model's own "nose" is far down the picture; his head is really up near where it was while he faced the camera.
    expect(TURNED_AWAY[0].y).toBeGreaterThan(0.6);
    expect(head.y).toBeLessThan(0.3);
    expect(Math.abs(head.y - headOf(FACING)!.y)).toBeLessThan(0.1);
    // Sideways he has barely moved in those two seconds.
    expect(Math.abs(head.x - headOf(FACING)!.x)).toBeLessThan(0.08);
    expect(head.size).toBeGreaterThan(0.05);
  });

  it("leaves a right-way-up figure low in the picture where it is", () => {
    const head = headOf(AUDIENCE)!;
    expect(head.y).toBeGreaterThan(0.6);
    expect(head.x).toBeCloseTo(AUDIENCE[0].x, 6);
  });

  it("still gives null when nothing usable is seen", () => {
    expect(headOf(lm(Array.from({ length: 33 }, () => [0.5, 0.5, 0])))).toBeNull();
  });
});
