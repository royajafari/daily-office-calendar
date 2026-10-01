import type { DetailedHTMLProps, HTMLAttributes } from "react";

/** The custom element defined by public/not-robot.js. */
export interface NotRobotCaptchaElement extends HTMLElement {
  readonly token: string;
  readonly valid: boolean;
  requireValid(): boolean;
  reset(): void;
}

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "not-robot-captcha": DetailedHTMLProps<HTMLAttributes<NotRobotCaptchaElement>, NotRobotCaptchaElement> & {
        server?: string;
        name?: string;
        guard?: "off";
      };
    }
  }
}
