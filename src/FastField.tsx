import * as PropTypes from 'prop-types';
import * as React from 'react';
import { validateYupSchema, yupToFormErrors } from './Formik';
import { getIn, isPromise, setIn, isFunction, isEmptyChildren } from './utils';
import warning from 'warning';
import { FieldAttributes, FieldConfig, FieldProps } from './Field';
import isEqual from 'react-fast-compare';

export interface FastFieldState {
  value: any;
  error?: string;
}

/** @private Returns whether two objects are deeply equal **excluding** a key / dot path */
function isEqualExceptForKey(a: any, b: any, path: string) {
  return isEqual(setIn(a, path, undefined), setIn(b, path, undefined));
}

/**
 * Custom Field component for quickly hooking into Formik
 * context and wiring up forms.
 */
export class FastField<
  Props extends FieldAttributes = any
> extends React.Component<Props, FastFieldState> {
  static contextTypes = {
    formik: PropTypes.object,
  };

  static propTypes = {
    name: PropTypes.string.isRequired,
    component: PropTypes.oneOfType([PropTypes.string, PropTypes.func]),
    render: PropTypes.func,
    children: PropTypes.oneOfType([PropTypes.func, PropTypes.node]),
    validate: PropTypes.func,
    innerRef: PropTypes.func,
  };

  reset: Function;
  setValue: Function;
  setError: Function;

  constructor(props: Props, context: any) {
    super(props);
    this.state = {
      value: getIn(context.formik.values, props.name),
      error: getIn(context.formik.errors, props.name),
    };

    this.reset = (nextValues?: any) => {
      this.setState({
        value: getIn(nextValues, props.name),
        error: getIn(context.formik.errors, props.name),
      });
    };

    this.setValue = (nextValue?: any) => {
      this.setState({
        value: nextValue,
      });
    };

    this.setError = (nextError?: any) => {
      this.setState({
        error: nextError,
      });
    };

    context.formik.registerField(props.name, {
      reset: this.reset,
      setValue: this.setValue,
      setError: this.setError,
    });
  }

  componentWillUnmount() {
    this.context.formik.unregisterField(this.props.name);
  }

  componentWillMount() {
    const { render, children, component } = this.props;

    warning(
      !(component && render),
      'You should not use <FastField component> and <FastField render> in the same <FastField> component; <FastField component> will be ignored'
    );

    warning(
      !(this.props.component && children && isFunction(children)),
      'You should not use <FastField component> and <FastField children> as a function in the same <FastField> component; <FastField component> will be ignored.'
    );

    warning(
      !(render && children && !isEmptyChildren(children)),
      'You should not use <FastField render> and <FastField children> in the same <FastField> component; <FastField children> will be ignored'
    );
  }

  runValidations = (value: any) => {
    const {
      validate,
      values,
      validationSchema,
      errors,
      setFormikState,
    } = this.context.formik;
    if (this.props.validate) {
      // Field-level validation
      const maybePromise = (this.props.validate as any)(value);
      if (isPromise(maybePromise)) {
        (maybePromise as any).then(
          () => this.setState({ error: undefined }),
          (error: string) => this.setState({ error })
        );
      } else {
        this.setState({ error: maybePromise });
      }
    } else if (validate) {
      // Top-level validate
      const maybePromise = (validate as any)(
        setIn(values, this.props.name, value)
      );

      if (isPromise(maybePromise)) {
        (maybePromise as any).then(
          () => this.setState({ error: undefined }),
          (error: any) => {
            // Here we diff the errors object relative to Formik parents except for
            // the Field's key. If they are equal, the field's validation function is
            // has no inter-field side-effects and we only need to update local state
            // otherwise we need to lift up the update to the parent (causing a full form render)
            if (isEqualExceptForKey(maybePromise, errors, this.props.name)) {
              this.setState({ error: getIn(error, this.props.name) });
            } else {
              setFormikState((prevState: any) => ({
                ...prevState,
                errors: error,
                // touched: setIn(prevState.touched, name, true),
              }));
            }
          }
        );
      } else {
        // Handle the same diff situation
        // @todo refactor
        if (isEqualExceptForKey(maybePromise, errors, this.props.name)) {
          this.setState({
            error: getIn(maybePromise, this.props.name),
          });
        } else {
          this.setState({ error: getIn(maybePromise, this.props.name) });
          setFormikState((prevState: any) => ({
            ...prevState,
            errors: maybePromise,
          }));
        }
      }
    } else if (validationSchema) {
      // Top-level validationsSchema
      const schema = isFunction(validationSchema)
        ? validationSchema()
        : validationSchema;
      const mergedValues = setIn(values, this.props.name, value);
      // try to validate with yup synchronously if possible...saves a render.
      try {
        validateYupSchema(mergedValues, schema, true);
        this.setState({
          error: undefined,
        });
      } catch (e) {
        if (e.name === 'ValidationError') {
          this.setState({
            error: getIn(yupToFormErrors(e), this.props.name),
          });
        } else {
          // try yup async validation
          validateYupSchema(mergedValues, schema).then(
            () => this.setState({ error: undefined }),
            (err: any) =>
              this.setState(prevState => ({
                ...prevState,
                error: getIn(yupToFormErrors(err), this.props.name),
              }))
          );
        }
      }
    }
  };

  handleChange = (e: React.ChangeEvent<any>) => {
    e.persist();
    const { validateOnChange } = this.context.formik;
    const { type, value, checked } = e.target;
    const val = /number|range/.test(type)
      ? parseFloat(value)
      : /checkbox/.test(type) ? checked : value;
    if (validateOnChange) {
      this.runValidations(val);
      this.setState({ value: val });
    } else {
      this.setState({ value: val });
    }
  };

  setFormikState = (value: any, error?: string) => {
    const { setFormikState } = this.context.formik;
    const { name } = this.props;
    setFormikState((prevState: any) => ({
      ...prevState,
      values: setIn(prevState.values, name, value),
      errors: setIn(prevState.errors, name, error),
      touched: setIn(prevState.touched, name, true),
    }));
  };

  handleBlur = () => {
    const { validateOnBlur } = this.context.formik;
    const { validate } = this.props;

    // @todo refactor
    if (validateOnBlur && validate) {
      const maybePromise = (validate as any)(this.state.value);
      if (isPromise(maybePromise)) {
        (maybePromise as Promise<any>).then(
          () => this.setFormikState(this.state.value),
          error => this.setFormikState(this.state.value, error)
        );
      } else {
        this.setFormikState(this.state.value, maybePromise);
      }
    } else {
      this.setFormikState(this.state.value, this.state.error);
    }
  };

  render() {
    const {
      validate,
      name,
      render,
      children,
      component = 'input',
      ...props
    } = this.props as FieldConfig;

    const { formik } = this.context;
    const field = {
      value:
        props.type === 'radio' || props.type === 'checkbox'
          ? props.value // React uses checked={} for these inputs
          : this.state.value,
      name,
      onChange: this.handleChange,
      onBlur: this.handleBlur,
    };
    const bag = {
      field,
      form: formik,
      meta: { touched: getIn(formik.touched, name), error: this.state.error },
    };

    if (render) {
      return (render as (
        props: FieldProps<any> & {
          meta: { error?: string; touched?: boolean };
        }
      ) => React.ReactNode)(bag);
    }

    if (isFunction(children)) {
      return (children as (props: FieldProps<any>) => React.ReactNode)(bag);
    }

    if (typeof component === 'string') {
      const { innerRef, ...rest } = props;
      return React.createElement(component as any, {
        ref: innerRef,
        ...field,
        ...rest,
        children,
      });
    }

    return React.createElement(component as any, {
      ...bag,
      ...props,
      children,
    });
  }
}
