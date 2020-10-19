/**
 * react-lazyload
 */
import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { on, off } from './utils/event';
import scrollParent from './utils/scrollParent';
import debounce from './utils/debounce';
import throttle from './utils/throttle';

// 在未捕获到dom 的 getBoundingClientRect ,默认该元素的距离浏览器为0
const defaultBoundingClientRect = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  width: 0,
  height: 0
};
// 用来标记占位元素
const LISTEN_FLAG = 'data-lazyload-listened';
// 监听元素
const listeners = [];
// 正在加载的组件队列
let pending = [];

// try to handle passive events
// chrome 51版本之后支持，ie不支持
// 是否支持 passive events，兼容性可参考 https://caniuse.com/#search=passive%20events
// 关于 peassive events https://blog.csdn.net/dj0379/article/details/52883315
let passiveEventSupported = false;
try {
  const opts = Object.defineProperty({}, 'passive', {
    get() {
      passiveEventSupported = true;
    }
  });
  window.addEventListener('test', null, opts);
} catch (e) {}
// if they are supported, setup the optional params
// IMPORTANT: FALSE doubles as the default CAPTURE value!
// 支持 passive events 会自动开启 passive 模式，addEventListener会默认 passive: true
// 有相关的第三方库 https://www.npmjs.com/package/default-passive-events 解决开发中警告问题
const passiveEvent = passiveEventSupported
  ? { capture: false, passive: true }
  : false;

/**
 * Check if `component` is visible in overflow container `parent`
 * 检查子组件的大小是否超过他父容器大小
 * @param  {node} component React component 子组件
 * @param  {node} parent    component's scroll parent 父组件
 * @return {bool}
 */

const checkOverflowVisible = function checkOverflowVisible(component, parent) {
  // ref获取真实dom
  const node = component.ref;

  // 父亲组件的在浏览器在距离与，参考 getBoundingClientRect api返回值
  // 参考 https://developer.mozilla.org/zh-CN/docs/Web/API/Element/getBoundingClientRect
  let parentTop;
  let parentLeft;
  let parentHeight;
  let parentWidth;

  try {
    ({
      top: parentTop,
      left: parentLeft,
      height: parentHeight,
      width: parentWidth
    } = parent.getBoundingClientRect());
  } catch (e) {
    ({
      top: parentTop,
      left: parentLeft,
      height: parentHeight,
      width: parentWidth
    } = defaultBoundingClientRect);
  }

  // 浏览器的高度与宽度
  const windowInnerHeight =
    window.innerHeight || document.documentElement.clientHeight;
  const windowInnerWidth =
    window.innerWidth || document.documentElement.clientWidth;

  // calculate top and height of the intersection of the element's scrollParent and viewport
  // 计算元素的父组件滚动与视口的交点高度与顶部
  const intersectionTop = Math.max(parentTop, 0); // intersection's top relative to viewport
  const intersectionLeft = Math.max(parentLeft, 0); // intersection's left relative to viewport
  const intersectionHeight =
    Math.min(windowInnerHeight, parentTop + parentHeight) - intersectionTop; // height
  const intersectionWidth =
    Math.min(windowInnerWidth, parentLeft + parentWidth) - intersectionLeft; // width

  // check whether the element is visible in the intersection
  // 检测是否在该焦点是可见的
  // 可以理解为元素滚动到相应的距离中
  let top;
  let left;
  let height;
  let width;

  try {
    ({ top, left, height, width } = node.getBoundingClientRect());
  } catch (e) {
    ({ top, left, height, width } = defaultBoundingClientRect);
  }

  const offsetTop = top - intersectionTop; // element's top relative to intersection
  const offsetLeft = left - intersectionLeft; // element's left relative to intersection

  const offsets = Array.isArray(component.props.offset)
    ? component.props.offset
    : [component.props.offset, component.props.offset]; // Be compatible with previous API

  return (
    offsetTop - offsets[0] <= intersectionHeight &&
    offsetTop + height + offsets[1] >= 0 &&
    offsetLeft - offsets[0] <= intersectionWidth &&
    offsetLeft + width + offsets[1] >= 0
  );
};

/**
 * Check if `component` is visible in document
 * 是否有 component 在 document
 * @param  {node} component React component
 * @return {bool}
 */
const checkNormalVisible = function checkNormalVisible(component) {
  const node = component.ref;

  // If this element is hidden by css rules somehow, it's definitely invisible
  // 如果该元素由于css隐藏被，可以视为不可见
  if (!(node.offsetWidth || node.offsetHeight || node.getClientRects().length))
    return false;

  let top;
  let elementHeight;

  try {
    ({ top, height: elementHeight } = node.getBoundingClientRect());
  } catch (e) {
    ({ top, height: elementHeight } = defaultBoundingClientRect);
  }

  const windowInnerHeight =
    window.innerHeight || document.documentElement.clientHeight;

  const offsets = Array.isArray(component.props.offset)
    ? component.props.offset
    : [component.props.offset, component.props.offset]; // Be compatible with previous API

  return (
    top - offsets[0] <= windowInnerHeight &&
    top + elementHeight + offsets[1] >= 0
  );
};

/**
 * Detect if element is visible in viewport, if so, set `visible` state to true.
 * If `once` prop is provided true, remove component as listener after checkVisible
 *
 * 检测元素是否可见在视口中，如果可见则设置visible状态，如果具有prop属性，在发现组件可见的情况下移除组件作为监听器
 * @param  {React} component   React component that respond to scroll and resize
 */
const checkVisible = function checkVisible(component) {
  const node = component.ref;
  if (!(node instanceof HTMLElement)) {
    return;
  }

  const parent = scrollParent(node);
  const isOverflow =
    component.props.overflow &&
    parent !== node.ownerDocument &&
    parent !== document &&
    parent !== document.documentElement;
  const visible = isOverflow
    ? checkOverflowVisible(component, parent)
    : checkNormalVisible(component);
  if (visible) {
    // Avoid extra render if previously is visible
    // 之前是的元素是可见的话就不继续渲染
    if (!component.visible) {
      if (component.props.once) {
        pending.push(component);
      }

      component.visible = true;
      component.forceUpdate();
    }
  } else if (!(component.props.once && component.visible)) {
    component.visible = false;
    if (component.props.unmountIfInvisible) {
      component.forceUpdate();
    }
  }
};

// 展位元素移除
const purgePending = function purgePending() {
  pending.forEach(component => {
    const index = listeners.indexOf(component);
    if (index !== -1) {
      listeners.splice(index, 1);
    }
  });

  pending = [];
};

// 遍历每个元素是否在可是区域内
const lazyLoadHandler = () => {
  for (let i = 0; i < listeners.length; ++i) {
    const listener = listeners[i];
    checkVisible(listener);
  }
  // Remove `once` component in listeners
  purgePending();
};

/**
 * Forces the component to display regardless of whether the element is visible in the viewport.
 * 无论是否该元素在可是区域内，强制元素可见，
 * 可能有些模块并不需要 lazyload 功能
 */
const forceVisible = () => {
  for (let i = 0; i < listeners.length; ++i) {
    const listener = listeners[i];
    listener.visible = true;
    listener.forceUpdate();
  }
  // Remove `once` component in listeners
  purgePending();
};

// Depending on component's props
// 延迟类型 节流 | 防抖
let delayType;
// 情况监听
let finalLazyLoadHandler = null;

const isString = string => typeof string === 'string';

class LazyLoad extends Component {
  constructor(props) {
    super(props);

    // 每个LazyLoad组件都具有visible属性
    this.visible = false;
    // setRef，来获取dom节点引用
    this.setRef = this.setRef.bind(this);
  }

  componentDidMount() {
    // It's unlikely to change delay type on the fly, this is mainly
    // designed for tests
     // 判断是容器，未指定就指向 window
    let scrollport = window;
    const { scrollContainer } = this.props;
   
    if (scrollContainer) {
      if (isString(scrollContainer)) {
        scrollport = scrollport.document.querySelector(scrollContainer);
      }
    }
    // 需要重置监听事件
    const needResetFinalLazyLoadHandler =
      (this.props.debounce !== undefined && delayType === 'throttle') ||
      (delayType === 'debounce' && this.props.debounce === undefined);
    // 如果重置则鞋子啊对元素的 resize 与 scroll的监听
    if (needResetFinalLazyLoadHandler) {
      off(scrollport, 'scroll', finalLazyLoadHandler, passiveEvent);
      off(window, 'resize', finalLazyLoadHandler, passiveEvent);
      finalLazyLoadHandler = null;
    }
    // 这是 finalLazyLoadHandler 函数，进行节流防抖优化还是直接调用 
    if (!finalLazyLoadHandler) {
      if (this.props.debounce !== undefined) {
        finalLazyLoadHandler = debounce(
          lazyLoadHandler,
          typeof this.props.debounce === 'number' ? this.props.debounce : 300
        );
        delayType = 'debounce';
      } else if (this.props.throttle !== undefined) {
        finalLazyLoadHandler = throttle(
          lazyLoadHandler,
          typeof this.props.throttle === 'number' ? this.props.throttle : 300
        );
        delayType = 'throttle';
      } else {
        finalLazyLoadHandler = lazyLoadHandler;
      }
    }

    // 如果元素超出可视区域，创建展位元素
    if (this.props.overflow) {
      // 需要该元素的父节点
      const parent = scrollParent(this.ref);
      // 如果这个怨怒是一个 function
      if (parent && typeof parent.getAttribute === 'function') {
        // 对占位元素进行累加赋值
        const listenerCount = 1 + +parent.getAttribute(LISTEN_FLAG);
        if (listenerCount === 1) {
          parent.addEventListener('scroll', finalLazyLoadHandler, passiveEvent);
        }
        // 展位元素
        parent.setAttribute(LISTEN_FLAG, listenerCount);
      }
      // 初始化元素进行绑定
    } else if (listeners.length === 0 || needResetFinalLazyLoadHandler) {
      const { scroll, resize } = this.props;

      if (scroll) {
        on(scrollport, 'scroll', finalLazyLoadHandler, passiveEvent);
      }

      if (resize) {
        on(window, 'resize', finalLazyLoadHandler, passiveEvent);
      }
    }
    // 将组件推入到监听队列中
    listeners.push(this);
    // 检测是否显示
    checkVisible(this);
  }

  // 根据visible是否显示判断是否更新组件
  shouldComponentUpdate() {
    return this.visible;
  }
  
  componentWillUnmount() {
    // 组件卸载时移除所有属性标签与事件绑定
    if (this.props.overflow) {
      const parent = scrollParent(this.ref);
      if (parent && typeof parent.getAttribute === 'function') {
        const listenerCount = +parent.getAttribute(LISTEN_FLAG) - 1;
        if (listenerCount === 0) {
          parent.removeEventListener(
            'scroll',
            finalLazyLoadHandler,
            passiveEvent
          );
          parent.removeAttribute(LISTEN_FLAG);
        } else {
          parent.setAttribute(LISTEN_FLAG, listenerCount);
        }
      }
    }

    const index = listeners.indexOf(this);
    if (index !== -1) {
      listeners.splice(index, 1);
    }

    if (listeners.length === 0 && typeof window !== 'undefined') {
      off(window, 'resize', finalLazyLoadHandler, passiveEvent);
      off(window, 'scroll', finalLazyLoadHandler, passiveEvent);
    }
  }

  // 获取dom引用
  setRef(element) {
    if (element) {
      this.ref = element;
    }
  }

  render() {
    // height:为展位逸元素高度
    // children为需要懒加载的 react 组件
    // placeholder 自定义占位元素
    // classNamePrefix 自定义class前缀
    const {
      height,
      children,
      placeholder,
      classNamePrefix
    } = this.props;

    return (
      <div className={`${classNamePrefix}-wrapper`} ref={this.setRef}>
        {this.visible ? (
          children
        ) : placeholder ? (
          placeholder
        ) : (
          <div
            style={{ height: height }}
            className={`${classNamePrefix}-placeholder`}
          />
        )}
      </div>
    );
  }
}

LazyLoad.propTypes = {
  classNamePrefix: PropTypes.string,
  once: PropTypes.bool,
  height: PropTypes.oneOfType([PropTypes.number, PropTypes.string]),
  offset: PropTypes.oneOfType([
    PropTypes.number,
    PropTypes.arrayOf(PropTypes.number)
  ]),
  overflow: PropTypes.bool,
  resize: PropTypes.bool,
  scroll: PropTypes.bool,
  children: PropTypes.node,
  throttle: PropTypes.oneOfType([PropTypes.number, PropTypes.bool]),
  debounce: PropTypes.oneOfType([PropTypes.number, PropTypes.bool]),
  placeholder: PropTypes.node,
  scrollContainer: PropTypes.oneOfType([PropTypes.string, PropTypes.object]),
  unmountIfInvisible: PropTypes.bool
};

LazyLoad.defaultProps = {
  classNamePrefix: 'lazyload',
  once: false,
  offset: 0,
  overflow: false,
  resize: false,
  scroll: true,
  unmountIfInvisible: false
};

const getDisplayName = WrappedComponent =>
  WrappedComponent.displayName || WrappedComponent.name || 'Component';

const decorator = (options = {}) =>
  function lazyload(WrappedComponent) {
    return class LazyLoadDecorated extends Component {
      constructor() {
        super();
        this.displayName = `LazyLoad${getDisplayName(WrappedComponent)}`;
      }

      render() {
        return (
          <LazyLoad {...options}>
            <WrappedComponent {...this.props} />
          </LazyLoad>
        );
      }
    };
  };

export { decorator as lazyload };
export default LazyLoad;
export { lazyLoadHandler as forceCheck };
export { forceVisible };
