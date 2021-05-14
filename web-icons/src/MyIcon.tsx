import React from 'react';
import * as icons from './assets';

export type IconType = keyof typeof icons;
interface MyIconProps extends React.SVGProps<SVGSVGElement> {
  name: IconType;
}

export default function MyIcon({ name, ...rest }: MyIconProps) {
  const SVGIcon = icons[name];
  return <SVGIcon {...rest} />;
}
