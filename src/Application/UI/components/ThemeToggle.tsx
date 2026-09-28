import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import UIEventBus from '../EventBus';
import { Easing } from '../Animation';
import { RoomTheme, storedTheme } from '../../World/Lighting';
// @ts-ignore
import sun from '../../../../static/textures/UI/sun.svg';
// @ts-ignore
import moon from '../../../../static/textures/UI/moon.svg';

interface ThemeToggleProps {}

const TRACK_W = 40;
const KNOB = 14;

/**
 * Sun / night switch for the room. A black pill with a white knob that slides;
 * the knob carries a pixel sun or moon. The Lighting class listens for the
 * `themeToggle` event and cross-fades the lights.
 */
const ThemeToggle: React.FC<ThemeToggleProps> = ({}) => {
    const [isHovering, setIsHovering] = useState(false);
    const [isActive, setIsActive] = useState(false);
    const [theme, setTheme] = useState<RoomTheme>(storedTheme());

    const onMouseDownHandler = useCallback(
        (event) => {
            setIsActive(true);
            event.preventDefault();
            setTheme(theme === 'night' ? 'day' : 'night');
        },
        [theme]
    );

    const onMouseUpHandler = useCallback(() => {
        setIsActive(false);
    }, []);

    useEffect(() => {
        UIEventBus.dispatch('themeToggle', theme);
    }, [theme]);

    const night = theme === 'night';

    return (
        <div
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            style={styles.container}
            onMouseDown={onMouseDownHandler}
            onMouseUp={onMouseUpHandler}
            className="theme-toggle-container"
            id="prevent-click"
            title={night ? 'Lights on' : 'Lights off'}
            aria-label={night ? 'Switch to day' : 'Switch to night'}
        >
            <motion.div
                id="prevent-click"
                style={styles.track}
                animate={
                    isActive ? 'active' : isHovering ? 'hovering' : 'default'
                }
                variants={trackVars}
            >
                <motion.div
                    id="prevent-click"
                    style={styles.knob}
                    animate={{ x: night ? TRACK_W - KNOB - 2 : 0 }}
                    transition={{ duration: 0.25, ease: Easing.expOut }}
                >
                    <img
                        id="prevent-click"
                        src={night ? moon : sun}
                        alt=""
                        width={10}
                        height={10}
                        draggable={false}
                    />
                </motion.div>
            </motion.div>
        </div>
    );
};

const trackVars = {
    hovering: {
        opacity: 0.8,
        transition: { duration: 0.1, ease: 'easeOut' },
    },
    active: {
        scale: 0.92,
        opacity: 0.6,
        transition: { duration: 0.1, ease: Easing.expOut },
    },
    default: {
        scale: 1,
        opacity: 1,
        transition: { duration: 0.2, ease: 'easeOut' },
    },
};

const styles: StyleSheetCSS = {
    container: {
        background: 'black',
        height: 26.5,
        paddingLeft: 6,
        paddingRight: 6,
        display: 'flex',
        boxSizing: 'border-box',
        justifyContent: 'center',
        alignItems: 'center',
        cursor: 'pointer',
    },
    track: {
        width: TRACK_W,
        height: KNOB + 4,
        boxSizing: 'border-box',
        border: '1px solid white',
        display: 'flex',
        alignItems: 'center',
        paddingLeft: 1,
    },
    knob: {
        width: KNOB,
        height: KNOB,
        background: 'white',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    },
};

export default ThemeToggle;
