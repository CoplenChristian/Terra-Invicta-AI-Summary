/**
 * src/v2/components/TwoColumnGrid.jsx
 *
 * Purpose: reusable layout primitive using `.init-view__grid` — two columns,
 * optional full-width span children via `init-view__span` on panel cards.
 */

import React from 'react';
import Box from '@mui/material/Box';

/**
 * @param {object} props
 * @param {boolean} [props.span=false] — full-width row spanning both columns
 * @param {React.ReactNode} props.children — usually a {@link Panel} or a panel that forwards `span`
 */
export function TwoColumnGridItem({ span = false, children }) {
  const child = React.Children.only(children);
  if (!span) {
    return child;
  }
  if (child.props?.span) {
    return child;
  }
  return React.cloneElement(child, { span: true });
}

/**
 * @param {object} props
 * @param {React.ReactNode} props.children — use {@link TwoColumnGridItem} for each cell
 * @param {object} [props.sx]
 */
export function TwoColumnGrid({ children, sx, ...rest }) {
  return (
    <Box
      component="div"
      className="init-view__grid"
      data-primitive="two-column-grid"
      sx={sx}
      {...rest}
    >
      {children}
    </Box>
  );
}

export default TwoColumnGrid;
