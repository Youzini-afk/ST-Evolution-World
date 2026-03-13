/**
 * 全局类型声明
 *
 * 声明 SillyTavern 主页面提供的全局变量，
 * 以及替代旧 TavernHelper 运行时注入的类型。
 */

// SillyTavern 全局
declare const SillyTavern: {
  getContext(): import('./st-adapter').STContext;
};

// jQuery（ST 主页面提供）
declare const jQuery: JQueryStatic;
declare const $: JQueryStatic;

// Lodash（ST 主页面提供）
declare const _: typeof import('lodash');

// Toastr（ST 主页面提供）
declare const toastr: Toastr;

// Klona
declare function klona<T>(val: T): T;
